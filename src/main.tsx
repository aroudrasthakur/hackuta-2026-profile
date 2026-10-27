import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexProvider } from "convex/react";
import { AuthBootstrap } from "./components/AuthBootstrap";
import { isMockApiEnabled } from "./constants/mockAuth";
import { MockAuthProvider } from "./components/MockAuthProvider";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SessionAuthProvider } from "./hooks/useSessionAuth";
import { convexClient } from "./convex/client";
import HomeRedirect from "./pages/HomeRedirect";
import ParticipantPortalLayout from "./pages/dashboard/ParticipantPortalLayout";
import ParticipantHomePage from "./pages/dashboard/ParticipantHomePage";
import ParticipantScanPage from "./pages/dashboard/ParticipantScanPage";
import ParticipantSchedulePage from "./pages/dashboard/ParticipantSchedulePage";
import ParticipantLeaderboardPage from "./pages/dashboard/ParticipantLeaderboardPage";
import ParticipantNotificationsPage from "./pages/dashboard/ParticipantNotificationsPage";
import ParticipantProfilePage from "./pages/dashboard/ParticipantProfilePage";
import ParticipantApplicationPage from "./pages/dashboard/ParticipantApplicationPage";
import SignInPage from "./pages/SignIn/SignInPage";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const useMockApi = isMockApiEnabled();

const app = (
  <React.StrictMode>
    <BrowserRouter>
      <AuthBootstrap>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/leaderboard" element={<Navigate to="/dashboard/leaderboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requireAuth>
                <ParticipantPortalLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ParticipantHomePage />} />
            <Route path="scan" element={<ParticipantScanPage />} />
            <Route path="schedule" element={<ParticipantSchedulePage />} />
            <Route path="leaderboard" element={<ParticipantLeaderboardPage />} />
            <Route path="notifications" element={<ParticipantNotificationsPage />} />
            <Route path="profile" element={<ParticipantProfilePage />} />
            <Route path="application" element={<ParticipantApplicationPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthBootstrap>
    </BrowserRouter>
  </React.StrictMode>
);

const withSession = <SessionAuthProvider>{app}</SessionAuthProvider>;

const content = useMockApi ? (
  <MockAuthProvider>
    {convexClient ? (
      <ConvexProvider client={convexClient}>{withSession}</ConvexProvider>
    ) : (
      withSession
    )}
  </MockAuthProvider>
) : convexClient ? (
  <ConvexAuthProvider client={convexClient} storage={window.sessionStorage}>
    {withSession}
  </ConvexAuthProvider>
) : (
  withSession
);

ReactDOM.createRoot(root).render(content);
