# Architecture

## Ownership

Station has two privileged processes and one unprivileged browser surface.

- The Electron Shell owns windows, application lifecycle, updates, native dialogs, and Host supervision.
- The Node Host owns one complete DeepSeek Harness profile generation and every process created by that generation.
- The Renderer uses the upstream Harness Web client and communicates with the Host over its existing loopback carrier.

No Cordis context, plugin service, terminal handle, or profile object crosses the process boundary. Messages carry only immutable lifecycle facts.

## Startup

1. Electron acquires the application single-instance lock.
2. The supervisor creates a generation id and a random launch capability.
3. Electron starts the Host with a private operating-system IPC channel.
4. The Host validates the start message and composes the published Harness `web` profile.
5. Harness binds an operating-system-assigned loopback port and activates the complete Cordis tree.
6. The Host sends the exact generation id and loopback origin to the Shell.
7. The Shell validates both values, creates a sandboxed BrowserWindow, and loads the origin.

Readiness is a property of the activated Harness tree, not an observed log line.

## Shutdown

The Shell sends a generation-scoped stop request. The Host disposes the Cordis root, acknowledges completion, and exits. If the process does not exit within the supervisor deadline, the Shell sends `SIGTERM`. Application exit waits for this sequence.

## Security

The Renderer has Node integration disabled, context isolation enabled, Chromium sandboxing enabled, and web security enabled. Main-frame navigation stays on the activated Host origin. New windows are denied; ordinary HTTP, HTTPS, and mail links are handed to the operating system.

The private launch capability authenticates lifecycle commands on the parent-child channel. It does not currently authenticate browser HTTP requests. Browser bootstrap authentication is required before Station exposes a Host beyond loopback or treats hostile local processes as part of its threat model.

## Extension direction

Native features become narrow Shell operations. Harness features remain Cordis plugins in the Host. Station does not introduce a second general-purpose plugin system or proxy arbitrary Electron APIs to plugins.
