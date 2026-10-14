import { AppHeader } from "@/components/app-header";

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return (
    // The header is sticky and full width; the content column takes the rest of
    // the height and is the only thing that grows. `min-w-0` is what stops a long
    // table row widening the column instead of truncating inside it.
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
