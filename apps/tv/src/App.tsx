// The composition root: the app shell with the one placeholder screen every route shows until its own task replaces it
// (sign-in T4, Home T5-03, libraries T6-01, the player T8, Settings T9). Libraries and the account arrive with T4 and T6-01.
import { FirstScreen } from "./first-screen/FirstScreen";
import { AppShell } from "./shell";

const screens = {
  home: FirstScreen,
  search: FirstScreen,
  library: FirstScreen,
  settings: FirstScreen,
  accounts: FirstScreen,
  item: FirstScreen,
  play: FirstScreen,
  signIn: FirstScreen,
};

export default function App() {
  return <AppShell screens={screens} libraries={[]} />;
}
