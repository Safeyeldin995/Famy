import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Issue 70 harness root missing");
createRoot(root).render(<App />);
