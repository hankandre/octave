import { registerRootComponent } from "expo";
import App from "./src/App";
// The e2e root, or Metro's empty module outside an e2e build (metro.config.js): its default import is then `{}`, not a
// function, so the release app registers App.
import E2eRoot from "./src/e2e/root";

registerRootComponent(typeof E2eRoot === "function" ? E2eRoot : App);
