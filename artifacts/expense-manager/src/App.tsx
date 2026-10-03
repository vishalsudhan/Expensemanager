import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { OfflineBanner } from '@/components/offline-banner';
import { OfflineProvider } from '@/components/offline-provider';
import { Toaster } from '@/components/ui/toaster';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  CircleHelp,
  Folder,
  Hash,
  House,
  Layers3,
  Menu,
  Plus,
  ReceiptText,
  Settings2,
  X,
} from 'lucide-react';
import { ProjectDetailPage, ProjectListPage } from '@/pages/Projects';
import { CategoryDetailPage, CategoryListPage } from '@/pages/Categories';
import { LabelListPage } from '@/pages/Labels';
import { ExpenseDetailPage, ExpenseEditorPage, ExpenseListPage } from '@/pages/Expenses';
import { HomePage } from '@/pages/Home';
import { ReportsPage } from '@/pages/Reports';
import { SettingsPage } from '@/pages/Settings';
import { ForgotPasswordPage } from '@/pages/ForgotPassword';
import { LoginPage, SetupPage } from '@/pages/Login';
import { ResetPasswordPage } from '@/pages/ResetPassword';
import { useAuthRedirect } from '@/hooks/use-auth';
import {
  Link,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

const destinations = [
  { label: 'Home', href: '/', icon: House },
  { label: 'Expenses', href: '/expenses', icon: ReceiptText },
  { label: 'Projects', href: '/projects', icon: Folder },
  { label: 'Categories', href: '/categories', icon: Layers3 },
  { label: 'Labels', href: '/labels', icon: Hash },
  { label: 'Reports', href: '/reports', icon: ChartNoAxesColumnIncreasing },
  { label: 'Settings', href: '/settings', icon: Settings2 },
];

const mobileDestinations = [
  destinations[0],
  destinations[1],
  destinations[2],
  destinations[5],
];

function titleFor(path: string): string {
  if (path === '/') return 'Home';
  if (path.startsWith('/expenses')) return 'Expenses';
  if (path.startsWith('/projects')) return 'Projects';
  if (path.startsWith('/categories')) return 'Categories';
  if (path.startsWith('/labels')) return 'Labels';
  if (path.startsWith('/reports')) return 'Reports';
  if (path.startsWith('/settings')) return 'Settings';
  return 'Not found';
}

function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <Link href="/" className="group flex items-center gap-3" data-testid="link-brand-home">
      <span className="grid size-10 place-items-center rounded-[14px] bg-primary text-primary-foreground shadow-sm">
        <span className="font-display text-[22px] font-bold leading-none">p</span>
      </span>
      <span className="leading-tight">
        <span className="block font-display text-[17px] font-bold tracking-[-0.04em]">pocketful</span>
        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{subtitle ?? 'a quieter money space'}</span>
      </span>
    </Link>
  );
}

function NavigationLink({ item, active }: { item: (typeof destinations)[number]; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      data-testid={`link-nav-${item.label.toLowerCase()}`}
      className={`nav-link flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-[13px] font-semibold ${
        active
          ? 'bg-secondary text-primary'
          : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
      }`}
    >
      <Icon size={18} strokeWidth={1.8} />
      <span>{item.label}</span>
      {active && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousLocation = useRef(location);
  const moreRoutes = ['/categories', '/labels', '/settings'];
  const moreActive = moreRoutes.includes(location);
  const pageTitle = titleFor(location);
  const moreDestinations = destinations.filter(
    (item) => !mobileDestinations.some((mobileItem) => mobileItem.href === item.href),
  );

  useEffect(() => {
    if (previousLocation.current === location) return;
    previousLocation.current = location;
    window.scrollTo({ top: 0, behavior: 'auto' });
    mainRef.current?.focus();
  }, [location]);

  return (
    <div className="app-shell soft-grain bg-background text-foreground">
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[252px] flex-col border-r border-border/80 bg-sidebar px-5 pb-5 pt-7 lg:flex">
        <Brand />
        <div className="mb-3 mt-12 px-3 text-[10px] font-bold uppercase tracking-[0.19em] text-muted-foreground/80">Your space</div>
        <nav aria-label="Main navigation" className="flex flex-col gap-1">
          {destinations.map((item) => (
            <NavigationLink
              key={item.href}
              item={item}
              active={location === item.href || ((item.href === '/projects' || item.href === '/expenses') && location.startsWith(`${item.href}/`))}
            />
          ))}
        </nav>
        <div className="mt-auto rounded-2xl border border-border/70 bg-background/70 p-4">
          <div className="mb-3 flex size-8 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <CircleHelp size={16} strokeWidth={1.8} />
          </div>
          <p className="font-display text-sm font-bold">A fresh start</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Your personal money space is ready when you are.</p>
        </div>
        <div className="mt-5 border-t border-border/70 pt-4 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">POCKETFUL <span className="mx-1.5">·</span> PERSONAL FINANCE</div>
      </aside>

      <div className="min-h-[100dvh] lg:pl-[252px]">
        <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md sm:px-8 lg:px-12">
          <div className="flex min-w-0 items-center gap-3 lg:hidden"><Brand subtitle={location === '/' ? undefined : pageTitle} /></div>
          <div className="hidden text-[12px] font-semibold text-muted-foreground lg:block">
            YOUR SPACE <span className="mx-2 text-border">/</span> <span className="text-foreground">{pageTitle}</span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-muted-foreground xl:inline">A little more in order.</span>
            <Link
              href="/expenses/new"
              aria-label="Add expense"
              data-testid="button-add-expense"
              className="inline-flex h-11 min-h-11 items-center gap-2 rounded-xl bg-primary px-3.5 text-[12px] font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 sm:px-4"
            >
              <Plus size={16} strokeWidth={2.5} />
              <span className="hidden sm:inline">Add expense</span>
              <span className="sm:hidden">Add</span>
            </Link>
          </div>
        </header>
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto w-full max-w-[1120px] px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8 outline-none sm:px-8 sm:pt-11 lg:px-12 lg:pb-16"
        >
          {children}
        </main>
      </div>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-[24px] border-t border-border bg-card px-3 pb-[max(env(safe-area-inset-bottom),20px)] pt-4 lg:hidden"
        >
          <SheetTitle className="px-2 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            More places
          </SheetTitle>
          <SheetDescription className="sr-only">Additional destinations</SheetDescription>
          <nav aria-label="More destinations" className="mt-2 flex flex-col">
            {moreDestinations.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                data-testid={`link-more-${item.label.toLowerCase()}`}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${location === item.href ? 'bg-secondary text-primary' : 'text-foreground hover:bg-muted'}`}
              >
                <item.icon size={17} strokeWidth={1.8} /><span>{item.label}</span><ArrowRight size={14} className="ml-auto text-muted-foreground" />
              </Link>
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-20 border-t border-border/80 bg-card/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {mobileDestinations.map((item) => {
            const Icon = item.icon;
            const active = location === item.href || ((item.href === '/projects' || item.href === '/expenses') && location.startsWith(`${item.href}/`));
            return (
              <Link key={item.href} href={item.href} data-testid={`mobile-nav-${item.label.toLowerCase()}`} aria-current={active ? 'page' : undefined} className={`nav-link flex min-h-[58px] min-w-[62px] flex-col items-center justify-center gap-1 rounded-xl px-2 text-[10px] font-semibold ${active ? 'text-primary' : 'text-muted-foreground'}`}>
                <Icon size={19} strokeWidth={active ? 2.2 : 1.8} /><span>{item.label}</span>
              </Link>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-label="More navigation" data-testid="mobile-nav-more" className={`nav-link flex min-h-[58px] min-w-[62px] flex-col items-center justify-center gap-1 rounded-xl px-2 text-[10px] font-semibold ${moreActive || moreOpen ? 'text-primary' : 'text-muted-foreground'}`}>
            {moreOpen ? <X size={19} /> : <Menu size={19} strokeWidth={1.8} />}<span>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="page-enter flex min-h-[55vh] flex-col items-start justify-center">
      <span className="mb-4 text-[10px] font-bold uppercase tracking-[0.19em] text-primary">A small detour</span>
      <h1 className="font-display text-5xl font-semibold tracking-[-0.06em]">This page isn’t here.</h1>
      <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">The address may have moved. Your home is just one step away.</p>
      <Link href="/" data-testid="link-not-found-home" className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">Return home <ArrowRight size={16} /></Link>
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

/** Screens reachable without a session. None of them render the app shell. */
function PublicRoutes() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/setup" component={SetupPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
    </Switch>
  );
}

/**
 * Gates the app behind a live session.
 *
 * The check runs on the server as well, so this only avoids rendering a shell
 * that would immediately receive 401s. A signed-out visitor is sent to the
 * login screen instead of seeing an empty dashboard.
 */
function ProtectedRoutes() {
  useAuthRedirect({ requireAuth: true });

  return (
    <Shell>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/expenses" component={ExpenseListPage} />
        <Route path="/expenses/new" component={ExpenseEditorPage} />
        <Route path="/expenses/:expenseId/edit" component={ExpenseEditorPage} />
        <Route path="/expenses/:expenseId" component={ExpenseDetailPage} />
        <Route path="/projects" component={ProjectListPage} />
        <Route path="/projects/:projectId" component={ProjectDetailPage} />
        <Route path="/categories" component={CategoryListPage} />
        <Route path="/categories/:categoryId" component={CategoryDetailPage} />
        <Route path="/labels" component={LabelListPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route><NotFoundPage /></Route>
      </Switch>
    </Shell>
  );
}

function Router() {
  const [pathname] = useLocation();
  const isPublic = ['/login', '/setup', '/forgot-password', '/reset-password'].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return (
    <RoutedErrorBoundary>
      {isPublic ? <PublicRoutes /> : <ProtectedRoutes />}
    </RoutedErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <OfflineProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <OfflineBanner />
          <Toaster />
        </TooltipProvider>
      </OfflineProvider>
    </QueryClientProvider>
  );
}

export default App;