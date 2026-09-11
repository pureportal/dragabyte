import argparse
import codecs
import os
from pathlib import Path
import select
import tempfile
import time

import pyte


class TerminalProcess:
    def __init__(self, binary, directory):
        self.screen = pyte.Screen(100, 24)
        self.stream = pyte.Stream(self.screen)
        self.output = ""
        self.decoder = codecs.getincrementaldecoder("utf-8")()
        if os.name == "nt":
            from winpty import PtyProcess

            environment = os.environ.copy()
            environment["TERM"] = "xterm-256color"
            self.process = PtyProcess.spawn(
                [str(binary), str(directory)], dimensions=(24, 100), env=environment
            )
            self.reader = self.process.fileobj
        else:
            import pty

            self.pid, self.reader = pty.fork()
            if self.pid == 0:
                os.environ["TERM"] = "xterm-256color"
                os.execv(str(binary), [str(binary), str(directory)])
            self.resize(24, 100)

    def write(self, text):
        if os.name == "nt":
            self.process.write(text)
        else:
            os.write(self.reader, text.encode())

    def read(self, timeout=0.1):
        if not select.select([self.reader], [], [], timeout)[0]:
            return
        try:
            if os.name == "nt":
                output = self.process.read(65536)
            else:
                output = self.decoder.decode(os.read(self.reader, 65536))
        except (EOFError, OSError):
            return
        if "\x1b[6n" in output:
            self.write("\x1b[1;1R")
        self.output += output
        self.stream.feed(output)

    def wait(self, predicate):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            self.read()
            text = "\n".join(self.screen.display)
            if predicate(text):
                return text
        raise AssertionError("Terminal state was not reached:\n" + text)

    def resize(self, rows, columns):
        self.screen.resize(lines=rows, columns=columns)
        if os.name == "nt":
            self.process.setwinsize(rows, columns)
        else:
            import fcntl
            import struct
            import termios

            fcntl.ioctl(self.reader, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))

    def finish(self):
        self.write("q")
        self.wait(lambda _: "\x1b[?1049l" in self.output)
        if os.name == "nt":
            deadline = time.monotonic() + 5
            while self.process.isalive() and time.monotonic() < deadline:
                self.read()
            assert not self.process.isalive()
            assert self.process.exitstatus == 0
            self.process.close()
        else:
            _, status = os.waitpid(self.pid, 0)
            assert os.waitstatus_to_exitcode(status) == 0
            os.close(self.reader)


def verify(binary, artifacts):
    with tempfile.TemporaryDirectory(prefix="dragabyte-terminal-") as directory:
        root = Path(directory)
        (root / "Media").mkdir()
        (root / "Notes").mkdir()
        (root / "Media" / "data.bin").write_bytes(bytes(8192))
        (root / "Notes" / "note.txt").write_bytes(bytes(1024))
        (root / "root.txt").write_bytes(bytes(1024))
        terminal = TerminalProcess(binary, root)
        try:
            overview = terminal.wait(lambda text: "Complete" in text and "80.0%" in text)
            assert "Media/" in overview and "Notes/" in overview
            terminal.write("\r")
            terminal.wait(lambda text: "data.bin" in text and "100.0%" in text)
            terminal.write("h")
            terminal.wait(lambda text: "Media/" in text and "Notes/" in text)
            terminal.write("/Notes")
            terminal.wait(lambda text: "Notes/" in text and "Media/" not in text)
            terminal.write("\x1b")
            terminal.wait(lambda text: "Media/" in text and "Notes/" in text)
            terminal.write("t")
            terminal.wait(lambda text: "Largest files" in text and "data.bin" in text)
            terminal.write("\r")
            terminal.wait(lambda text: "Largest files" not in text and "100.0%" in text)
            terminal.write("r")
            terminal.wait(lambda text: "Complete" in text and "Media/" in text)
            terminal.resize(18, 70)
            terminal.wait(lambda text: "Media/" in text and "q Quit" in text)
            terminal.finish()
        except BaseException:
            if os.name == "nt":
                terminal.process.terminate(force=True)
            else:
                import signal

                os.kill(terminal.pid, signal.SIGTERM)
                os.waitpid(terminal.pid, 0)
                os.close(terminal.reader)
            raise
        if artifacts:
            artifacts.mkdir(parents=True, exist_ok=True)
            (artifacts / "terminal-screen.txt").write_text(overview, encoding="utf-8")
            (artifacts / "terminal-session.txt").write_text(terminal.output, encoding="utf-8")
        print("PASS: graph, navigation, filter, largest files, refresh, resize, quit, terminal restoration")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    parser.add_argument("--artifacts", type=Path)
    arguments = parser.parse_args()
    verify(arguments.binary.resolve(), arguments.artifacts)
