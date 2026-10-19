import { useContext } from "react";
import { MockAuthContext } from "./mockAuthContext";

export function useMockAuth() {
  return useContext(MockAuthContext);
}
