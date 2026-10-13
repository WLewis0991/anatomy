import { ShellHeader } from "@/components/shell-header";

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-col">
      <ShellHeader />
      {children}
    </div>
  );
}
