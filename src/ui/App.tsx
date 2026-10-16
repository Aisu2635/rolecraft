import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { BuilderPage } from "./pages/BuilderPage";
import { LandingPage } from "./pages/LandingPage";
import { TemplatesPage } from "./pages/TemplatesPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LandingPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="builder" element={<BuilderPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
