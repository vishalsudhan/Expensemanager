import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  CircleHelp,
  Folder,
  Hash,
  House,
  Layers3,
  Menu,
  Plus,
  ReceiptText,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { ProjectDetailPage, ProjectListPage } from '@/pages/Projects';
import { CategoryDetailPage, CategoryListPage } from '@/pages/Categories';
import { LabelListPage } from '@/pages/Labels';
import { ExpenseDetailPage, ExpenseEditorPage, ExpenseListPage } from '@/pages/Expenses';
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

const pageCopy: Record<string, { title: string; eyebrow: string; description: string; icon: typeof ReceiptText }> = {
  '/expenses': {
    title: 'Expenses',
    eyebrow: 'YOUR SPENDING',
    description: 'A clear record of what you spend, all in one place.',
    icon: ReceiptText,
  },
  '/projects': {
    title: 'Projects',
    eyebrow: 'SPENDING WITH PURPOSE',
    description: 'Keep related expenses together around the things that matter.',
    icon: Folder,
  },
  '/categories': {
    title: 'Categories',
    eyebrow: 'A LITTLE ORDER',
    description: 'Shape a set of categories that feels natural to you.',
    icon: Layers3,
  },
  '/labels': {
    title: 'Labels',
    eyebrow: 'YOUR OWN WAY',
    description: 'Add another layer of meaning to the way you organize spending.',
    icon: Hash,
  },
  '/reports': {
    title: 'Reports',
    eyebrow: 'THE BIG PICTURE',
    description: 'A thoughtful view of your spending will live here.',
    icon: ChartNoAxesColumnIncreasing,
  },
  '/settings': {
    title: 'Settings',
    eyebrow: 'MAKE IT YOURS',
    description: 'Personal preferences and account details will have a home here.',
    icon: SlidersHorizontal,
  },
};

function Brand() {
  return (
    <Link href="/" className="group flex items-center gap-3" data-testid="link-brand-home">
      <span className="grid size-10 place-items-center rounded-[14px] bg-primary text-primary-foreground shadow-sm">
        <span className="font-display text-[22px] font-bold leading-none">p</span>
      </span>
      <span className="leading-tight">
        <span className="block font-display text-[17px] font-bold tracking-[-0.04em]">pocketful</span>
        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">a quieter money space</span>
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
  const moreRoutes = ['/categories', '/labels', '/settings'];
  const moreActive = moreRoutes.includes(location);
  const pageTitle = location === '/'
    ? 'Home'
    : location.startsWith('/projects')
      ? 'Projects'
      : location.startsWith('/expenses')
        ? 'Expenses'
        : pageCopy[location]?.title ?? 'Not found';

  return (
    <div className="app-shell soft-grain bg-background text-foreground">
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
        <div className="mt-5 border-t border-border/70 pt-4 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">POCKETFUL <span className="mx-1.5">·</span> STAGE SIX</div>
      </aside>

      <div className="min-h-[100dvh] lg:pl-[252px]">
        <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md sm:px-8 lg:px-12">
          <div className="flex items-center gap-3 lg:hidden"><Brand /></div>
          <div className="hidden text-[12px] font-semibold text-muted-foreground lg:block">
            YOUR SPACE <span className="mx-2 text-border">/</span> <span className="text-foreground">{pageTitle}</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">A little more in order.</span>
            <Link
              href="/expenses/new"
              aria-label="Add expense"
              data-testid="button-add-expense"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3.5 text-[12px] font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 sm:px-4"
            >
              <Plus size={16} strokeWidth={2.5} />
              <span className="hidden sm:inline">Add expense</span>
              <span className="sm:hidden">Add</span>
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1120px] px-5 pb-28 pt-8 sm:px-8 sm:pt-11 lg:px-12 lg:pb-16">
          {children}
        </main>
      </div>

      {moreOpen && (
        <div className="fixed inset-x-3 bottom-[82px] z-30 rounded-2xl border border-border bg-card p-2 shadow-[0_16px_50px_-20px_hsl(163_18%_19%/.28)] lg:hidden" role="dialog" aria-label="More destinations">
          <div className="flex items-center justify-between px-3 pb-1 pt-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">More places</span>
            <button type="button" onClick={() => setMoreOpen(false)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Close more menu" data-testid="button-close-more"><X size={16} /></button>
          </div>
          {destinations.filter((item) => !mobileDestinations.some((mobileItem) => mobileItem.href === item.href)).map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)} data-testid={`link-more-${item.label.toLowerCase()}`} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${location === item.href ? 'bg-secondary text-primary' : 'text-foreground hover:bg-muted'}`}>
              <item.icon size={17} strokeWidth={1.8} /><span>{item.label}</span><ArrowRight size={14} className="ml-auto text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}

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

function HomePage() {
  return (
    <div className="page-enter">
      <div className="mb-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.19em] text-primary">
        <span className="size-1.5 rounded-full bg-primary" /> YOUR PERSONAL MONEY SPACE
      </div>
      <section className="relative overflow-hidden rounded-[28px] border border-border/70 bg-card px-6 py-8 sm:px-10 sm:py-11 lg:px-12 lg:py-[54px]">
        <div className="pointer-events-none absolute -right-20 -top-16 hidden aspect-square w-[390px] opacity-65 sm:block">
          <div className="home-orbit h-full w-full rounded-full" />
          <div className="absolute left-[47%] top-[46%] size-5 rounded-full bg-primary/70 ring-[10px] ring-primary/10" />
        </div>
        <div className="relative max-w-[570px]">
          <p className="mb-4 text-xs font-semibold text-muted-foreground">A calmer way to keep track</p>
          <h1 className="font-display text-[42px] font-semibold leading-[1.06] tracking-[-0.055em] sm:text-[58px]">
            Your spending,<br /><span className="text-primary">in its place.</span>
          </h1>
          <p className="mt-5 max-w-[390px] text-[14px] leading-6 text-muted-foreground sm:text-[15px]">
            A little space to gather the details, see what matters, and feel more at ease with your money.
          </p>
          <Link href="/expenses" data-testid="link-home-expenses" className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-bold text-primary-foreground transition-transform hover:-translate-y-0.5">
            Visit your expenses <ArrowRight size={16} />
          </Link>
        </div>
        <div className="relative mt-10 flex items-center gap-2 border-t border-border/70 pt-5 text-[11px] text-muted-foreground sm:max-w-[530px]">
          <span className="inline-block size-1.5 rounded-full bg-[#b77c64]" />
          Nothing to catch up on. This space is just getting started.
        </div>
      </section>

      <section className="mt-10 grid gap-8 md:grid-cols-[1fr_0.82fr] md:gap-12">
        <div className="pt-1">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.17em] text-muted-foreground">Start where you are</div>
          <h2 className="font-display text-[25px] font-semibold tracking-[-0.04em] sm:text-[30px]">A good place to begin.</h2>
          <p className="mt-3 max-w-[430px] text-sm leading-6 text-muted-foreground">Make this space yours at your own pace. The essentials are here, ready whenever you need them.</p>
          <Link href="/categories" data-testid="link-home-categories" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 text-[12px] font-bold text-foreground transition-colors hover:bg-muted">
            Explore categories <ArrowRight size={15} />
          </Link>
        </div>
        <div className="rounded-2xl border border-border/70 bg-secondary/45 p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-card text-primary"><ChevronDown size={18} className="-rotate-90" /></div>
            <div>
              <p className="font-display text-[16px] font-bold tracking-[-0.02em]">Built around you</p>
              <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">Projects, labels, and reports will all have their own thoughtful corner.</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 pl-14">
            <Link href="/projects" className="rounded-full border border-border/80 bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-primary" data-testid="link-home-projects">Projects</Link>
            <Link href="/labels" className="rounded-full border border-border/80 bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-primary" data-testid="link-home-labels">Labels</Link>
            <Link href="/reports" className="rounded-full border border-border/80 bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-primary" data-testid="link-home-reports">Reports</Link>
          </div>
        </div>
      </section>
      <footer className="mt-12 flex flex-col gap-2 border-t border-border/70 pt-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>A personal space, with no rush.</span>
        <Link href="/settings" data-testid="link-home-settings" className="font-semibold text-primary hover:underline">Make it yours <ArrowRight className="ml-1 inline" size={13} /></Link>
      </footer>
    </div>
  );
}

function PlaceholderPage({ path }: { path: string }) {
  const info = pageCopy[path];
  if (!info) return <NotFoundPage />;
  const Icon = info.icon;
  return (
    <div className="page-enter">
      <div className="mb-8 text-[10px] font-bold uppercase tracking-[0.19em] text-primary">{info.eyebrow}</div>
      <div className="max-w-[760px] border-b border-border/80 pb-8 sm:pb-10">
        <div className="mb-5 grid size-12 place-items-center rounded-[16px] bg-secondary text-primary"><Icon size={22} strokeWidth={1.7} /></div>
        <h1 className="font-display text-[40px] font-semibold leading-none tracking-[-0.055em] sm:text-[52px]">{info.title}</h1>
        <p className="mt-4 max-w-[460px] text-[14px] leading-6 text-muted-foreground sm:text-[15px]">{info.description}</p>
      </div>
      <section className="mt-8 max-w-[760px] rounded-[22px] border border-dashed border-border bg-card/55 px-6 py-9 sm:px-9 sm:py-11">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/70 text-accent-foreground"><Icon size={18} strokeWidth={1.8} /></div>
          <div>
            <div className="font-display text-[19px] font-semibold tracking-[-0.03em]">This space is taking shape.</div>
            <p className="mt-2 max-w-[430px] text-[13px] leading-6 text-muted-foreground">This part of Pocketful is part of the foundation. There’s no data to show just yet — the useful details will arrive in a later stage.</p>
            <Link href="/" data-testid={`link-${path.slice(1)}-home`} className="mt-5 inline-flex min-h-10 items-center gap-2 text-[12px] font-bold text-primary hover:underline">Back to your home <ArrowRight size={15} /></Link>
          </div>
        </div>
      </section>
      <div className="mt-8 text-[11px] text-muted-foreground">Foundation stage <span className="mx-1.5">·</span> No entries yet</div>
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

function Router() {
  return (
    <RoutedErrorBoundary>
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
          <Route path="/reports"><PlaceholderPage path="/reports" /></Route>
          <Route path="/settings"><PlaceholderPage path="/settings" /></Route>
          <Route><NotFoundPage /></Route>
        </Switch>
      </Shell>
    </RoutedErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;