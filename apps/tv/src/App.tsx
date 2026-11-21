// The composition root: the navigation container and its one route. T3-09 builds the shell and routes on it.
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { FirstScreen } from "./first-screen/FirstScreen";
import { colors } from "./first-screen/placeholder-values";

const Stack = createNativeStackNavigator();

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.surface0 } };

export default function App() {
  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="First" component={FirstScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
