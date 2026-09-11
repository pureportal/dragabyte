use super::{
    explorer::Explorer,
    format::{bar, fit_path, safe_text, size},
    index::RowId,
};
use crate::{disk::DiskUsageSnapshot, scan::ScanState};
use ratatui::{
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Cell, Clear, Gauge, Paragraph, Row, Table, Wrap},
    Frame,
};

pub(super) struct Theme {
    pub ascii: bool,
    pub no_color: bool,
}

impl Theme {
    fn accent(&self) -> Style {
        if self.no_color {
            Style::default().bold()
        } else {
            Style::default().fg(Color::Cyan)
        }
    }

    fn muted(&self) -> Style {
        if self.no_color {
            Style::default()
        } else {
            Style::default().fg(Color::DarkGray)
        }
    }

    fn border(&self) -> BorderType {
        if self.ascii {
            BorderType::Plain
        } else {
            BorderType::Rounded
        }
    }

    fn block(&self) -> Block<'static> {
        let block = Block::default()
            .borders(Borders::ALL)
            .border_type(self.border())
            .border_style(self.muted());
        if self.ascii {
            block.border_set(ratatui::symbols::border::Set {
                top_left: "+",
                top_right: "+",
                bottom_left: "+",
                bottom_right: "+",
                vertical_left: "|",
                vertical_right: "|",
                horizontal_top: "-",
                horizontal_bottom: "-",
            })
        } else {
            block
        }
    }
}

pub(super) fn draw(
    frame: &mut Frame,
    app: &mut Explorer,
    disk: Option<&DiskUsageSnapshot>,
    theme: &Theme,
) {
    let area = frame.area();
    if area.width < 42 || area.height < 10 {
        frame.render_widget(
            Paragraph::new("Enlarge the terminal to 42 x 10.\nq Quit"),
            area,
        );
        return;
    }
    let show_disk = disk.is_some() && area.height >= 16;
    let chunks = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(if show_disk { 2 } else { 0 }),
        Constraint::Min(3),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .split(area);
    let folder = app.index.folders.get(app.current);
    let title = if app.largest {
        "Largest files".to_string()
    } else {
        folder
            .map(|folder| fit_path(&folder.data.path, area.width as usize))
            .unwrap_or_else(|| "Scanning".into())
    };
    let current_bytes = folder.map_or(0, |folder| folder.data.size_bytes);
    let current_files = folder.map_or(0, |folder| folder.data.file_count);
    let current_dirs = folder.map_or(0, |folder| folder.data.dir_count);
    let status = if app.failure.is_some() {
        "Failed"
    } else if app.cancelled {
        "Stopped"
    } else if !app.finished {
        "Scanning"
    } else if app.index.skipped_entries > 0 {
        "Incomplete"
    } else {
        "Complete"
    };
    let header = Paragraph::new(vec![
        Line::styled(title, theme.accent().bold()),
        Line::from(format!(
            "{}   {} files   {} folders   {}  {:.1}s",
            size(current_bytes),
            current_files,
            current_dirs,
            status,
            app.index.duration_ms as f64 / 1000.0
        )),
    ])
    .block(theme.block().title(" Dragabyte ").borders(Borders::TOP));
    frame.render_widget(header, chunks[0]);
    if show_disk {
        let disk = disk.unwrap();
        let ratio = if disk.total_bytes == 0 {
            0.0
        } else {
            1.0 - (disk.free_bytes as f64 / disk.total_bytes as f64).clamp(0.0, 1.0)
        };
        let label = format!(
            "Disk   {} free / {}",
            size(disk.free_bytes),
            size(disk.total_bytes)
        );
        if theme.ascii {
            frame.render_widget(
                Paragraph::new(format!(
                    "{label}  {}",
                    bar(
                        disk.total_bytes.saturating_sub(disk.free_bytes),
                        disk.total_bytes,
                        16,
                        true
                    )
                )),
                chunks[1],
            );
        } else {
            frame.render_widget(
                Gauge::default()
                    .ratio(ratio)
                    .label(label)
                    .gauge_style(theme.accent())
                    .block(
                        Block::default()
                            .borders(Borders::BOTTOM)
                            .border_style(theme.muted()),
                    ),
                chunks[1],
            );
        }
    }
    let wide = chunks[2].width >= 80;
    let graph_width = if wide { 18 } else { 8 };
    let total = if app.largest {
        app.index.total_bytes
    } else {
        current_bytes
    };
    let state_marker = |row: RowId| match row {
        RowId::Folder(id) => match app.index.folders[id].data.state {
            ScanState::Scanning => " ~",
            ScanState::Incomplete => " !",
            ScanState::Complete => "",
        },
        RowId::File(_) => "",
    };
    let visible_count = chunks[2].height.saturating_sub(4).max(1) as usize;
    let selected = app.selection.selected().unwrap_or(0);
    let offset = app
        .selection
        .offset()
        .min(selected)
        .max(selected.saturating_sub(visible_count - 1));
    *app.selection.offset_mut() = offset;
    let rows = app
        .rows
        .iter()
        .skip(offset)
        .take(visible_count)
        .map(|&row| {
            let bytes = app.index.size(row);
            let percent = if total == 0 {
                0.0
            } else {
                bytes as f64 * 100.0 / total as f64
            };
            let suffix = if matches!(row, RowId::Folder(_)) {
                "/"
            } else {
                ""
            };
            let name = format!(
                "{}{suffix}{}",
                safe_text(app.index.name(row)),
                state_marker(row)
            );
            let name_style = if matches!(row, RowId::Folder(_)) {
                theme.accent()
            } else {
                Style::default()
            };
            let mut cells = vec![
                Cell::from(Line::from(size(bytes)).right_aligned()),
                Cell::from(Line::from(format!("{percent:5.1}%")).right_aligned()),
                Cell::from(bar(bytes, total, graph_width, theme.ascii)).style(theme.accent()),
            ];
            if wide {
                cells.push(Cell::from(
                    Line::from(app.index.count(row).to_string()).right_aligned(),
                ));
            }
            cells.push(Cell::from(name).style(name_style));
            Row::new(cells)
        })
        .collect::<Vec<_>>();
    let mut widths = vec![
        Constraint::Length(10),
        Constraint::Length(6),
        Constraint::Length(graph_width as u16),
    ];
    let mut headers = vec!["File size", "Share", ""];
    if wide {
        widths.push(Constraint::Length(8));
        headers.push("Files");
    }
    widths.push(Constraint::Min(8));
    headers.push("Name");
    let sort = if app.largest {
        "Size"
    } else {
        app.sort.label()
    };
    let direction = if app.reverse { "reversed" } else { "" };
    let table = Table::new(rows, widths)
        .header(Row::new(headers).style(theme.muted()).bottom_margin(1))
        .column_spacing(2)
        .row_highlight_style(Style::default().add_modifier(Modifier::REVERSED | Modifier::BOLD))
        .highlight_symbol(if theme.ascii { "> " } else { "› " })
        .block(theme.block().title(format!(
            " {}/{} | {sort} {direction} ",
            if app.rows.is_empty() { 0 } else { selected + 1 },
            app.rows.len()
        )));
    let mut visible_selection = ratatui::widgets::TableState::default()
        .with_selected(app.selection.selected().map(|index| index - offset));
    frame.render_stateful_widget(table, chunks[2], &mut visible_selection);
    if app.rows.is_empty() {
        let empty = Rect {
            x: chunks[2].x + 2,
            y: chunks[2].y + 3,
            width: chunks[2].width.saturating_sub(4),
            height: 1,
        };
        frame.render_widget(
            Paragraph::new(if app.finished {
                "No entries"
            } else {
                "Scanning..."
            })
            .style(theme.muted()),
            empty,
        );
    }
    let detail = if let Some(failure) = &app.failure {
        format!("{}  r Retry", safe_text(failure))
    } else if app.editing || !app.filter.is_empty() {
        format!(
            "/ {}{}",
            safe_text(&app.filter),
            if app.editing { "_" } else { "" }
        )
    } else if app.index.skipped_entries > 0 {
        format!(
            "{} entries could not be read; totals are incomplete.  r Retry",
            app.index.skipped_entries
        )
    } else if let Some(row) = app.selected() {
        fit_path(app.index.path(row), area.width as usize)
    } else {
        String::new()
    };
    frame.render_widget(Paragraph::new(detail).style(theme.muted()), chunks[3]);
    let controls = if app.editing {
        "Enter Apply  Esc Clear"
    } else if area.width >= 80 {
        "↑↓ Move  Enter Open  ← Back  / Filter  s Size  n Name  t Largest  ? Help  q Quit"
    } else {
        "Enter Open  ← Back  / Filter  ?  q Quit"
    };
    let controls = if theme.ascii {
        controls.replace("↑↓", "j/k").replace('←', "h")
    } else {
        controls.to_string()
    };
    frame.render_widget(Paragraph::new(controls), chunks[4]);
    if app.help {
        draw_help(frame, theme);
    }
}

fn draw_help(frame: &mut Frame, theme: &Theme) {
    let width = frame.area().width.min(62);
    let height = frame.area().height.min(20);
    let area = Rect::new(
        (frame.area().width - width) / 2,
        (frame.area().height - height) / 2,
        width,
        height,
    );
    let help = [
        ("j/k, arrows", "Move"),
        ("Enter, l", "Open folder"),
        ("Backspace, h", "Parent folder"),
        ("g", "Scan root"),
        ("Home/End, PgUp/PgDn", "Jump / page"),
        ("/", "Filter this folder"),
        ("s / n / c", "Sort by size / name / file count"),
        ("v", "Reverse order"),
        ("d", "Toggle folders only"),
        ("t", "Largest 100 files; Enter locates file"),
        ("r", "Rescan root"),
        ("Esc", "Clear filter / stop scan"),
        ("q, Ctrl+C", "Quit"),
        ("~ / !", "Scanning / incomplete folder"),
    ];
    let lines = help
        .into_iter()
        .map(|(key, action)| {
            Line::from(vec![
                Span::styled(format!(" {key:21}"), theme.accent()),
                Span::raw(action),
            ])
        })
        .collect::<Vec<_>>();
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(theme.block().title(" Keys ")),
        area,
    );
}
