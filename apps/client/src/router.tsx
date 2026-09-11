import { RootRoute, Route, Router } from "@tanstack/react-router";
import App from "./App";
import ScanView from "./features/scan/ScanView";
import BulkRenameView from "./features/bulk-rename/BulkRenameView";

const rootRoute = new RootRoute({
  component: App,
});

const indexRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ScanView,
});

const renameRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/bulk-rename",
  component: BulkRenameView,
});

const routeTree = rootRoute.addChildren([indexRoute, renameRoute]);

export const router = new Router({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
