import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Failed to find the root element");

// StrictMode intentionally omitted: react-three-rapier's Physics component
// calls world.free() on cleanup, which panics in the Rapier WASM module when
// StrictMode double-fires effects ("attempted to take ownership of Rust value
// while it was borrowed").
ReactDOM.createRoot(root).render(<App />);
