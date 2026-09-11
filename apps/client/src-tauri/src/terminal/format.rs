pub(super) fn size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

pub(super) fn safe_text(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(character, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            {
                '\u{fffd}'
            } else {
                character
            }
        })
        .collect()
}

pub(super) fn display_path(value: &str) -> String {
    #[cfg(windows)]
    if let Some(path) = value.strip_prefix(r"\\?\UNC\") {
        return safe_text(&format!(r"\\{path}"));
    } else if let Some(path) = value.strip_prefix(r"\\?\") {
        return safe_text(path);
    }
    safe_text(value)
}

pub(super) fn fit_path(value: &str, width: usize) -> String {
    let text = display_path(value);
    if ratatui::text::Line::raw(&text).width() <= width {
        return text;
    }
    let mut remaining = width.saturating_sub(3);
    let mut start = text.len();
    for (position, character) in text.char_indices().rev() {
        let character_width = ratatui::text::Line::raw(character.to_string()).width();
        if character_width > remaining {
            break;
        }
        remaining -= character_width;
        start = position;
    }
    format!("...{}", &text[start..])
}

pub(super) fn bar(bytes: u64, total: u64, width: usize, ascii: bool) -> String {
    let filled = if total == 0 {
        0
    } else {
        ((bytes as f64 / total as f64).clamp(0.0, 1.0) * width as f64).round() as usize
    };
    format!(
        "{}{}",
        if ascii { "#" } else { "━" }.repeat(filled),
        if ascii { "." } else { "─" }.repeat(width - filled)
    )
}
