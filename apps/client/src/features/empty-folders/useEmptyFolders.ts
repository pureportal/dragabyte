import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { toErrorMessage } from "../../lib/utils";
import { updateSelection } from "./model";
import type {
  EmptyFolderOptions,
  EmptyFolderPreview,
  FolderProgress,
  RemovalOutcome,
  RemovalResult,
} from "./types";

interface FolderState {
  preview: EmptyFolderPreview | null;
  previewId: string;
  selected: Set<string>;
  outcomes: RemovalOutcome[];
  activity: "finding" | "removing" | null;
  progress: FolderProgress | null;
  error: string;
  result: string;
}

const initialState: FolderState = {
  preview: null,
  previewId: "",
  selected: new Set(),
  outcomes: [],
  activity: null,
  progress: null,
  error: "",
  result: "",
};

export function useEmptyFolders() {
  const [state, setState] = useState(initialState);
  const operation = useRef<{
    id: string;
    cancelling: boolean;
    started: boolean;
  } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const running = operation.current;
      if (running) {
        running.cancelling = true;
        if (running.started)
          void invoke("cancel_empty_folders", { id: running.id }).catch(
            console.error,
          );
      }
    };
  }, []);

  const cancel = async () => {
    const running = operation.current;
    if (!running) return;
    running.cancelling = true;
    if (!running.started) return;
    try {
      await invoke("cancel_empty_folders", { id: running.id });
    } catch (error) {
      if (mounted.current)
        setState((previous) => ({ ...previous, error: toErrorMessage(error) }));
    }
  };

  const run = async (
    activity: "finding" | "removing",
    payload: Record<string, unknown>,
  ) => {
    if (operation.current) return;
    const running = {
      id: crypto.randomUUID(),
      cancelling: false,
      started: false,
    };
    operation.current = running;
    setState((previous) => ({
      ...(activity === "finding" ? initialState : previous),
      activity,
      error: "",
      result: "",
      progress: null,
    }));
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<FolderProgress>(
        "empty-folders-progress",
        ({ payload }) => {
          if (mounted.current && payload.id === running.id)
            setState((previous) => ({ ...previous, progress: payload }));
        },
      );
      if (running.cancelling) return;
      running.started = true;
      if (activity === "finding") {
        const preview = await invoke<EmptyFolderPreview>(
          "preview_empty_folders",
          { ...payload, id: running.id },
        );
        if (mounted.current)
          setState((previous) => ({
            ...previous,
            preview,
            previewId: preview.cancelled ? "" : running.id,
            selected: preview.cancelled
              ? new Set()
              : new Set(preview.folders.map((folder) => folder.path)),
            result: preview.cancelled
              ? "Search cancelled. Find folders again to remove them."
              : "",
          }));
      } else {
        const result = await invoke<RemovalResult>(
          "remove_empty_folders_preview",
          { ...payload, id: running.id },
        );
        if (mounted.current)
          setState((previous) => {
            const byPath = new Map(
              previous.outcomes.map((outcome) => [outcome.path, outcome]),
            );
            for (const outcome of result.outcomes)
              byPath.set(outcome.path, outcome);
            const outcomes = [...byPath.values()];
            const removed = new Set(
              outcomes
                .filter((outcome) => outcome.error === null)
                .map((outcome) => outcome.path),
            );
            const failures = result.outcomes.filter(
              (outcome) => outcome.error !== null,
            ).length;
            return {
              ...previous,
              outcomes,
              selected: new Set(
                [...previous.selected].filter((path) => !removed.has(path)),
              ),
              result: `${removed.size} ${removed.size === 1 ? "folder" : "folders"} removed.${failures ? ` ${failures} failed.` : ""}${result.cancelled ? " Removal cancelled." : ""}`,
            };
          });
      }
    } catch (error) {
      if (mounted.current)
        setState((previous) => ({ ...previous, error: toErrorMessage(error) }));
    } finally {
      unlisten?.();
      operation.current = null;
      if (mounted.current)
        setState((previous) => ({ ...previous, activity: null }));
    }
  };

  return {
    ...state,
    find: (paths: string[], options: EmptyFolderOptions) =>
      run("finding", { paths, options }),
    remove: () =>
      run("removing", {
        paths: [...state.selected],
        previewId: state.previewId,
      }),
    cancel,
    invalidate: () => {
      if (!operation.current) setState(initialState);
    },
    select: (paths: string[], checked: boolean) =>
      setState((previous) => ({
        ...previous,
        selected: updateSelection(
          previous.preview?.folders ?? [],
          previous.selected,
          paths,
          checked,
          previous.outcomes,
        ),
      })),
    setError: (error: string) =>
      setState((previous) => ({ ...previous, error })),
  };
}
