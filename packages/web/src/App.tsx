import "./App.css";
import { Routes, Route } from "react-router";
import Home from "./pages/Home";
import Login from "./pages/Login";
import { ThemeProvider } from "./components/theme-provider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
