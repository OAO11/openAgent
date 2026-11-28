// Local synthetic performance harness transport; no login or remote-session helpers.
import { writeFile } from "node:fs/promises";

export class CdpClient {
  static async connect(endpoint, timeoutMs = 10_000) {
    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`CDP connect timeout: ${endpoint}`)), timeoutMs);
      socket.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`CDP connection failed: ${endpoint}`));
      };
    });
    return new CdpClient(socket, timeoutMs);
  }

  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    };
    socket.onclose = () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    };
  }

  request(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  async evaluate(expression, awaitPromise = true) {
    const response = await this.request("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  }

  async screenshot(path) {
    const result = await this.request("Page.captureScreenshot", { format: "png", fromSurface: true });
    if (!result.data) throw new Error("CDP returned no screenshot data");
    await writeFile(path, Buffer.from(result.data, "base64"));
  }

  close() {
    this.socket.close();
  }
}
