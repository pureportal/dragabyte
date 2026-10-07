import { RootRoute, Route, Router } from "@tanstack/react-router";
import App from "./App";
import ScanView from "./features/scan/ScanView";
import BulkRenameView from "./features/bulk-rename/BulkRenameView";
import EmptyFoldersView from "./features/empty-folders/EmptyFoldersView";

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

const emptyFoldersRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/empty-folders",
  component: EmptyFoldersView,
});

const routeTree = rootRoute.addChildren([indexRoute, renameRoute, emptyFoldersRoute]);

export const router = new Router({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
