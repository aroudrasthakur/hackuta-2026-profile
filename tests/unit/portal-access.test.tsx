/** @vitest-environment happy-dom */

import { getByRole, getByText, queryByText } from "@testing-library/dom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedRoute } from "../../src/components/ProtectedRoute";
import {
  PORTAL_APPLICATION_REQUIRED_LINK_LABEL,
  PORTAL_APPLICATION_REQUIRED_LOCATION_STATE,
  PORTAL_APPLICATION_REQUIRED_MESSAGE,
} from "../../src/constants/authMessages";
import { REGISTER_URL } from "../../src/constants/site";
import HomeRedirect from "../../src/pages/HomeRedirect";
import SignInPage from "../../src/pages/SignIn/SignInPage";

const routing = vi.hoisted(() => ({
  value: {
    isLoading: false,
    isAuthenticated: false,
    verifiedEmail: null as string | null,
    hasSubmittedRegistration: false,
  },
}));

const session = vi.hoisted(() => ({
  isLoading: false,
  isAuthenticated: false,
  signOut: vi.fn(async () => {
    session.isAuthenticated = false;
    routing.value = { ...routing.value, isAuthenticated: false };
  }),
}));

vi.mock("../../src/hooks/useApplicantRouting", () => ({
  useApplicantRouting: () => routing.value,
}));

vi.mock("../../src/hooks/useSessionAuth", () => ({
  useSessionAuth: () => session,
  SessionAuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: vi.fn(),
    signOut: session.signOut,
  }),
  useConvexAuth: () => ({
    isLoading: session.isLoading,
    isAuthenticated: session.isAuthenticated,
    fetchAccessToken: vi.fn(),
  }),
}));

vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/react")>();
  return {
    ...actual,
    useQuery: () => undefined,
    useMutation: () => vi.fn(),
  };
});

vi.mock("../../src/components/SignInStormBackdrop", () => ({
  SignInStormBackdrop: () => null,
}));

vi.mock("../../src/convex/client", () => ({
  convexClient: null,
  getConvexClient: () => null,
}));

type Mounted = { root: Root; container: HTMLElement };
const mounted: Mounted[] = [];

function render(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return container;
}

function LocationProbe() {
  const location = useLocation();
  const state = location.state as { applicationRequired?: boolean; from?: string } | null;
  return (
    <div>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="from">{state?.from ?? ""}</div>
      <div data-testid="application-required">{state?.applicationRequired ? "yes" : "no"}</div>
    </div>
  );
}

function resetRouting() {
  routing.value = {
    isLoading: false,
    isAuthenticated: false,
    verifiedEmail: null,
    hasSubmittedRegistration: false,
  };
  session.isLoading = false;
  session.isAuthenticated = false;
  session.signOut = vi.fn(async () => {
    session.isAuthenticated = false;
    routing.value = { ...routing.value, isAuthenticated: false };
  });
}

beforeEach(() => {
  resetRouting();
});

afterEach(() => {
  act(() => {
    for (const { root, container } of mounted.splice(0)) {
      root.unmount();
      container.remove();
    }
  });
});

describe("ProtectedRoute", () => {
  function renderDashboard() {
    return render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requireAuth>
                <div>Dashboard</div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/sign-in"
            element={
              <>
                <div>Sign In Page</div>
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows an accessible loading state while routing resolves", () => {
    routing.value.isLoading = true;
    const container = renderDashboard();
    expect(getByRole(container, "status").textContent).toContain("Loading");
    expect(queryByText(container, "Dashboard")).toBeNull();
  });

  it("sends signed-out users to sign-in", () => {
    const container = renderDashboard();
    expect(getByText(container, "Sign In Page")).toBeTruthy();
    expect(container.querySelector("[data-testid='from']")?.textContent).toBe("/dashboard");
    expect(container.querySelector("[data-testid='application-required']")?.textContent).toBe("no");
  });

  it("blocks authenticated users who have not submitted an application", () => {
    routing.value = {
      ...routing.value,
      isAuthenticated: true,
      verifiedEmail: "draft@example.com",
      hasSubmittedRegistration: false,
    };
    const container = renderDashboard();
    expect(getByText(container, "Sign In Page")).toBeTruthy();
    expect(queryByText(container, "Dashboard")).toBeNull();
    expect(container.querySelector("[data-testid='application-required']")?.textContent).toBe("yes");
  });

  it("renders the dashboard for submitted applicants", () => {
    routing.value = {
      ...routing.value,
      isAuthenticated: true,
      verifiedEmail: "accepted@example.com",
      hasSubmittedRegistration: true,
    };
    const container = renderDashboard();
    expect(getByText(container, "Dashboard")).toBeTruthy();
  });
});

describe("HomeRedirect", () => {
  function renderHome() {
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route
            path="/sign-in"
            element={
              <>
                <div>Sign In Page</div>
                <LocationProbe />
              </>
            }
          />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("sends signed-out users to sign-in", () => {
    const container = renderHome();
    expect(getByText(container, "Sign In Page")).toBeTruthy();
  });

  it("sends account-only sessions to sign-in with the application-required flag", () => {
    routing.value = {
      ...routing.value,
      isAuthenticated: true,
      verifiedEmail: "draft@example.com",
      hasSubmittedRegistration: false,
    };
    const container = renderHome();
    expect(getByText(container, "Sign In Page")).toBeTruthy();
    expect(queryByText(container, "Dashboard")).toBeNull();
    expect(container.querySelector("[data-testid='application-required']")?.textContent).toBe("yes");
  });

  it("sends submitted applicants to the dashboard", () => {
    routing.value = {
      ...routing.value,
      isAuthenticated: true,
      verifiedEmail: "accepted@example.com",
      hasSubmittedRegistration: true,
    };
    const container = renderHome();
    expect(getByText(container, "Dashboard")).toBeTruthy();
  });
});

describe("SignInPage portal gate", () => {
  function renderSignIn(state?: { applicationRequired?: boolean }) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: "/sign-in", state }]}>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the application-required banner from location state", () => {
    const container = renderSignIn(PORTAL_APPLICATION_REQUIRED_LOCATION_STATE);
    expect(getByText(container, PORTAL_APPLICATION_REQUIRED_MESSAGE, { exact: false })).toBeTruthy();
    const link = getByRole(container, "link", { name: PORTAL_APPLICATION_REQUIRED_LINK_LABEL });
    expect(link.getAttribute("href")).toBe(REGISTER_URL);
    expect(queryByText(container, "Dashboard")).toBeNull();
  });

  it("signs out unsubmitted sessions and keeps them on sign-in", async () => {
    session.isAuthenticated = true;
    routing.value = {
      ...routing.value,
      isAuthenticated: true,
      verifiedEmail: "draft@example.com",
      hasSubmittedRegistration: false,
    };
    const container = renderSignIn();
    await act(async () => {
      await Promise.resolve();
    });
    expect(session.signOut).toHaveBeenCalled();
    expect(getByText(container, PORTAL_APPLICATION_REQUIRED_MESSAGE, { exact: false })).toBeTruthy();
    expect(queryByText(container, "Dashboard")).toBeNull();
  });

  it("sends submitted applicants to the dashboard without signing them out", () => {
    session.isAuthenticated = true;
    routing.value = {
      ...routing.value,
      isAuthenticated: true,
      verifiedEmail: "accepted@example.com",
      hasSubmittedRegistration: true,
    };
    const container = renderSignIn();
    expect(getByText(container, "Dashboard")).toBeTruthy();
    expect(session.signOut).not.toHaveBeenCalled();
  });
});
