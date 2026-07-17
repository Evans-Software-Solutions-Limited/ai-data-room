import "./App.css";
import { Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ThemeProvider } from "./components/theme-provider";
import LoggedInPageLayout from "./containers/LoggedInPageLayout";
import LoggedOutPageLayout from "./containers/LoggedOutPageLayout";
import AppWorkspace from "./pages/AppWorkspace";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Logout from "./pages/Logout";
import Mfa from "./pages/Mfa";
import Room from "./pages/Room";
import Signup from "./pages/Signup";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Routes>
          <Route element={<LoggedInPageLayout />}>
            <Route path="/app" element={<AppWorkspace />} />
          </Route>
          {/* `/room` is a full-bleed app shell that owns its own chrome +
              auth guard (see Room.tsx), so it sits OUTSIDE
              LoggedInPageLayout to avoid stacking the global NavBar above
              the room's own top bar. */}
          <Route path="/room" element={<Room />} />
          <Route element={<LoggedOutPageLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/logout" element={<Logout />} />
            <Route path="/mfa" element={<Mfa />} />
          </Route>
        </Routes>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
