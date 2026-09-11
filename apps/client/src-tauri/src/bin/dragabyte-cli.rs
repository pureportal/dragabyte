fn main() -> std::process::ExitCode {
    match dragabyte::terminal::run() {
        Ok(code) => std::process::ExitCode::from(code),
        Err(error) => {
            eprintln!("dragabyte: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
