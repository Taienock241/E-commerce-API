import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HashRouter } from "react-router-dom";
import { App, CartDrawer, StatusActionButtons } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./ui/ToastContext";
import type { Cart } from "./api/types";
import { cartWithQuantity } from "./cart/optimistic";
import { formatMoney } from "./lib/money";

const user = { id: "user-1", name: "Sam", email: "sam@example.com", role: "CUSTOMER", createdAt: "2026-01-01" };
const cart: Cart = {
  items: [{ productId: "product-1", name: "Ceramic cup", unitPriceCents: 1250, quantity: 1, lineTotalCents: 1250, available: true }],
  itemCount: 1,
  totalCents: 1250,
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function wrapper(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={queryClient}><HashRouter><AuthProvider><ToastProvider>{children}</ToastProvider></AuthProvider></HashRouter></QueryClientProvider>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "#/";
  vi.stubGlobal("crypto", { randomUUID: () => "checkout-key-0001" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("frontend helpers", () => {
  it("formats integer cents with the single configured currency", () => {
    expect(formatMoney(1250)).toContain("12.50");
    expect(formatMoney(0)).toContain("0.00");
  });

  it("recalculates optimistic cart totals and can restore the original snapshot", () => {
    const optimistic = cartWithQuantity(cart, "product-1", 2);
    expect(optimistic.items[0].quantity).toBe(2);
    expect(optimistic.items[0].lineTotalCents).toBe(2500);
    expect(optimistic.totalCents).toBe(2500);
    // TanStack Query's onError restores this unchanged snapshot when the API rejects a change.
    expect(cart.items[0].quantity).toBe(1);
    expect(cart.totalCents).toBe(1250);
  });
});

describe("cart request states", () => {
  it("optimistically changes quantity and rolls it back after a 409 response", async () => {
    localStorage.setItem("ecommerce.token", "customer-token");
    localStorage.setItem("ecommerce.user", JSON.stringify(user));
    const patchResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/auth/me") return Promise.resolve(response(user));
      if (url === "/cart") return Promise.resolve(response(cart));
      if (url.includes("/cart/items/") && init?.method === "PATCH") return patchResponse.promise;
      return Promise.resolve(response({}));
    }));

    const userAction = userEvent.setup();
    render(wrapper(<CartDrawer open onClose={() => undefined} />));
    const increase = await screen.findByRole("button", { name: "Increase Ceramic cup quantity" });
    await userAction.click(increase);
    await waitFor(() => expect(screen.getByText("2", { selector: ".quantity-control span" })).toBeTruthy());

    patchResponse.resolve(response({ error: { code: "INSUFFICIENT_STOCK", message: "Only 1 in stock" } }, 409));
    await waitFor(() => expect(screen.getByText("1", { selector: ".quantity-control span" })).toBeTruthy());
    expect(await screen.findByText(/quantity is no longer available/i)).toBeTruthy();
  });

  it("disables checkout while its request is in flight", async () => {
    localStorage.setItem("ecommerce.token", "customer-token");
    localStorage.setItem("ecommerce.user", JSON.stringify(user));
    const checkoutResponse = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/auth/me") return Promise.resolve(response(user));
      if (url === "/cart") return Promise.resolve(response(cart));
      if (url === "/orders" && init?.method === "POST") return checkoutResponse.promise;
      return Promise.resolve(response({}));
    }));

    const userAction = userEvent.setup();
    render(wrapper(<CartDrawer open onClose={() => undefined} />));
    const checkout = await screen.findByRole("button", { name: /continue to checkout/i });
    await userAction.click(checkout);
    expect(await screen.findByRole("button", { name: /placing your order/i })).toHaveProperty("disabled", true);
    checkoutResponse.resolve(response({ id: "order-1", status: "PENDING", totalCents: 1250, userId: "user-1", createdAt: "2026-01-01", updatedAt: "2026-01-01", items: [] }));
  });
});

describe("access and order actions", () => {
  it("redirects a customer away from the admin page", async () => {
    localStorage.setItem("ecommerce.token", "customer-token");
    localStorage.setItem("ecommerce.user", JSON.stringify(user));
    window.location.hash = "#/admin";
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/auth/me") return Promise.resolve(response(user));
      if (url === "/cart") return Promise.resolve(response({ items: [], itemCount: 0, totalCents: 0 }));
      if (url.startsWith("/products")) return Promise.resolve(response({ data: [], meta: { page: 1, limit: 12, total: 0, totalPages: 0 } }));
      return Promise.resolve(response({}));
    }));

    render(wrapper(<App />));
    await waitFor(() => expect(window.location.hash).toBe("#/"));
    expect(screen.queryByRole("heading", { name: "Admin desk" })).toBeNull();
  });

  it("renders only the allowed next-status buttons for each order state", async () => {
    const onChoose = vi.fn();
    const { rerender } = render(<StatusActionButtons status="PENDING" disabled={false} onChoose={onChoose} />);
    expect(screen.getByRole("button", { name: "Mark paid" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ship" })).toBeNull();

    rerender(<StatusActionButtons status="SHIPPED" disabled={false} onChoose={onChoose} />);
    expect(screen.getByRole("button", { name: "Mark delivered" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark delivered" }));
    expect(onChoose).toHaveBeenCalledWith("DELIVERED");
  });
});
