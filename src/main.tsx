import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { fetchSettings } from "./features/settings/api";
import "./index.css";
import { promptUpdateIfAvailable } from "./lib/updater";
import { router } from "./router";

const queryClient = new QueryClient();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const startAutoUpdate = async (): Promise<void> => {
  try {
    const settings = await fetchSettings();
    if (settings.autoUpdate === false) return;
    await promptUpdateIfAvailable();
  } catch {
    return;
  }
};

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

void startAutoUpdate();
