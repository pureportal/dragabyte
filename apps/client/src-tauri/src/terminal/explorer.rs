use super::index::{RowId, ScanIndex, Sort};
use crate::scan::ScanEvent;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::widgets::TableState;
use std::collections::HashMap;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Action {
    None,
    Quit,
    Cancel,
    Refresh,
}

#[derive(Default)]
pub(super) struct Explorer {
    pub index: ScanIndex,
    pub current: usize,
    pub rows: Vec<RowId>,
    pub selection: TableState,
    pub sort: Sort,
    pub reverse: bool,
    pub folders_only: bool,
    pub filter: String,
    pub editing: bool,
    pub help: bool,
    pub largest: bool,
    pub finished: bool,
    pub cancelled: bool,
    pub failure: Option<String>,
    history: HashMap<usize, RowId>,
}

impl Explorer {
    pub fn apply(&mut self, event: ScanEvent) {
        match event {
            ScanEvent::Progress(update) => self.index.apply(update),
            ScanEvent::Complete(update) => {
                self.index.apply(update);
                self.index.complete = self.index.skipped_entries == 0;
                self.finished = true;
            }
            ScanEvent::Cancelled(update) => {
                self.index.apply(update);
                self.cancelled = true;
                self.finished = true;
            }
            ScanEvent::Error(failure) => {
                self.failure = Some(failure.message);
                self.finished = true;
            }
        }
    }

    pub fn selected(&self) -> Option<RowId> {
        self.selection
            .selected()
            .and_then(|index| self.rows.get(index).copied())
    }

    pub fn rebuild(&mut self) {
        let selected = self.selected();
        if self.index.folders.is_empty() {
            return;
        }
        self.rows = if self.largest {
            self.index.largest.clone()
        } else {
            self.index.listing(self.current, self.sort)
        };
        let filter = self.filter.to_lowercase();
        self.rows.retain(|&row| {
            (!self.folders_only || matches!(row, RowId::Folder(_)))
                && (filter.is_empty() || self.index.name(row).to_lowercase().contains(&filter))
        });
        if self.reverse {
            self.rows.reverse();
        }
        let position = selected
            .and_then(|row| self.rows.iter().position(|candidate| *candidate == row))
            .unwrap_or(0);
        self.selection
            .select((!self.rows.is_empty()).then_some(position));
    }

    pub fn navigate(&mut self, folder: usize) {
        if let Some(row) = self.selected() {
            self.history.insert(self.current, row);
        }
        self.current = folder;
        self.largest = false;
        self.filter.clear();
        self.rows.clear();
        self.selection = TableState::default();
        self.rebuild();
        if let Some(row) = self.history.get(&folder) {
            if let Some(position) = self.rows.iter().position(|candidate| candidate == row) {
                self.selection.select(Some(position));
            }
        }
    }

    fn move_selection(&mut self, delta: isize) {
        if self.rows.is_empty() {
            return;
        }
        let current = self.selection.selected().unwrap_or(0);
        self.selection.select(Some(
            current
                .saturating_add_signed(delta)
                .min(self.rows.len() - 1),
        ));
    }

    pub fn key(&mut self, key: KeyEvent, page_size: usize) -> Action {
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return Action::Quit;
        }
        if self.help {
            self.help = false;
            return Action::None;
        }
        if self.editing {
            match key.code {
                KeyCode::Enter => self.editing = false,
                KeyCode::Esc => {
                    self.editing = false;
                    self.filter.clear();
                }
                KeyCode::Backspace => {
                    self.filter.pop();
                }
                KeyCode::Char(character)
                    if !key.modifiers.contains(KeyModifiers::CONTROL)
                        && !character.is_control() =>
                {
                    self.filter.push(character)
                }
                _ => {}
            }
            self.rebuild();
            return Action::None;
        }
        match key.code {
            KeyCode::Char('q') => return Action::Quit,
            KeyCode::Esc if !self.filter.is_empty() => {
                self.filter.clear();
                self.rebuild();
            }
            KeyCode::Esc if self.largest => {
                self.largest = false;
                self.rebuild();
            }
            KeyCode::Esc if !self.finished => return Action::Cancel,
            KeyCode::Char('r') => return Action::Refresh,
            KeyCode::Char('?') => self.help = true,
            KeyCode::Down | KeyCode::Char('j') => self.move_selection(1),
            KeyCode::Up | KeyCode::Char('k') => self.move_selection(-1),
            KeyCode::PageDown => self.move_selection(page_size as isize),
            KeyCode::PageUp => self.move_selection(-(page_size as isize)),
            KeyCode::Home => self.move_selection(-(self.rows.len() as isize)),
            KeyCode::End => self.move_selection(self.rows.len() as isize),
            KeyCode::Enter | KeyCode::Right | KeyCode::Char('l') => match self.selected() {
                Some(RowId::Folder(id)) => self.navigate(id),
                Some(RowId::File(id)) if self.largest => {
                    let parent = self.index.files[id].parent_id;
                    self.navigate(parent);
                    self.selection
                        .select(self.rows.iter().position(|row| *row == RowId::File(id)));
                }
                _ => {}
            },
            KeyCode::Left | KeyCode::Backspace | KeyCode::Char('h') => {
                if let Some(parent) = self
                    .index
                    .folders
                    .get(self.current)
                    .and_then(|folder| folder.data.parent_id)
                {
                    self.navigate(parent);
                }
            }
            KeyCode::Char('g') if !self.index.folders.is_empty() => self.navigate(0),
            KeyCode::Char('/') => self.editing = true,
            KeyCode::Char('s') => {
                self.sort = Sort::Size;
                self.largest = false;
                self.rebuild();
            }
            KeyCode::Char('n') => {
                self.sort = Sort::Name;
                self.largest = false;
                self.rebuild();
            }
            KeyCode::Char('c') => {
                self.sort = Sort::Count;
                self.largest = false;
                self.rebuild();
            }
            KeyCode::Char('v') => {
                self.reverse = !self.reverse;
                self.rebuild();
            }
            KeyCode::Char('d') => {
                self.folders_only = !self.folders_only;
                self.rebuild();
            }
            KeyCode::Char('t') => {
                self.largest = !self.largest;
                self.folders_only = false;
                self.rebuild();
            }
            _ => {}
        }
        Action::None
    }
}
