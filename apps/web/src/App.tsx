import { Navigate, Route, Routes } from 'react-router';
import { ArticlePage } from './pages/ArticlePage';
import { BoardPage } from './pages/BoardPage';
import { EditorPage } from './pages/EditorPage';
import { FactsPage } from './pages/FactsPage';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { StylesPage } from './pages/StylesPage';
import { UsersPage } from './pages/UsersPage';
import { SessionProvider } from './session/SessionContext';
import { AppShell } from './shell/AppShell';
import { RequireSession } from './shell/RequireSession';

export function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireSession>
              <AppShell />
            </RequireSession>
          }
        >
          <Route index element={<BoardPage />} />
          <Route path="articles/:id" element={<ArticlePage />} />
          <Route path="articles/:id/edit" element={<EditorPage />} />
          <Route path="facts" element={<FactsPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="styles" element={<StylesPage />} />
          <Route
            path="admin/users"
            element={
              <RequireSession roles={['admin']}>
                <UsersPage />
              </RequireSession>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
