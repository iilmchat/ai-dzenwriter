import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ArticlePage } from './pages/ArticlePage';
import { AuditPage } from './pages/AuditPage';
import { BoardPage } from './pages/BoardPage';
import { FactsPage } from './pages/FactsPage';
import { LoginPage } from './pages/LoginPage';
import { MetricsPage } from './pages/MetricsPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { PilotPage } from './pages/PilotPage';
import { ProductsPage } from './pages/ProductsPage';
import { PublicationsPage } from './pages/PublicationsPage';
import { StylesPage } from './pages/StylesPage';
import { UsersPage } from './pages/UsersPage';
import { SessionProvider } from './session/SessionContext';
import { AppShell } from './shell/AppShell';
import { RequireSession } from './shell/RequireSession';

// Редактор тянет CodeMirror и react-markdown. Отдельный чанк не грузит их тем,
// кто работает только с доской, фактами или метриками.
const EditorPage = lazy(() =>
  import('./pages/EditorPage').then((module) => ({ default: module.EditorPage })),
);

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
          <Route path="tasks" element={<MyTasksPage />} />
          <Route path="articles/:id" element={<ArticlePage />} />
          <Route
            path="articles/:id/edit"
            element={
              <Suspense
                fallback={
                  <p role="status" className="p-6 text-sm text-on-surface-variant">
                    Загрузка редактора…
                  </p>
                }
              >
                <EditorPage />
              </Suspense>
            }
          />
          <Route path="facts" element={<FactsPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="publications" element={<PublicationsPage />} />
          <Route path="metrics" element={<MetricsPage />} />
          <Route path="styles" element={<StylesPage />} />
          <Route
            path="admin/pilot"
            element={
              <RequireSession roles={['admin']}>
                <PilotPage />
              </RequireSession>
            }
          />
          <Route
            path="admin/audit"
            element={
              <RequireSession roles={['admin']}>
                <AuditPage />
              </RequireSession>
            }
          />
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
