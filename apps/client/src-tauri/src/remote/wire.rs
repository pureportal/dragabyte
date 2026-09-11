use std::io::{self, BufRead};

#[derive(Default)]
pub struct LineReader {
    pending: Vec<u8>,
}

impl LineReader {
    pub fn read(&mut self, reader: &mut impl BufRead, limit: usize) -> io::Result<Option<String>> {
        loop {
            let available = reader.fill_buf()?;
            if available.is_empty() {
                if self.pending.is_empty() {
                    return Ok(None);
                }
                return self.finish().map(Some);
            }
            let newline = available.iter().position(|&byte| byte == b'\n');
            let count = newline.map_or(available.len(), |position| position + 1);
            if self.pending.len() + count > limit {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Request is too large",
                ));
            }
            self.pending.extend_from_slice(&available[..count]);
            reader.consume(count);
            if newline.is_some() {
                return self.finish().map(Some);
            }
        }
    }

    fn finish(&mut self) -> io::Result<String> {
        String::from_utf8(std::mem::take(&mut self.pending))
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }
}
