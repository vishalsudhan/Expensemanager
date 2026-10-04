import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  Archive, ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleDollarSign,
  FolderKanban, Briefcase, House, LoaderCircle, Pencil, Plane, Plus,
  RotateCcw, Sparkles, Tag, Trash2, Wallet,
} from 'lucide-react';
import {
  getGetProjectQueryKey, getListProjectsQueryKey, useArchiveProject,
  useCreateProject, useDeleteProject, useGetProject, useListProjects, useUpdateProject,
} from '@workspace/api-client-react';
import type { Project, ProjectInput, ProjectUpdate } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useCurrencyOptions } from '@/hooks/use-currencies';
import { errorText, formatDate, formatTotals, money } from '@/lib/format';
import { DeleteRecordDialog } from '@/components/delete-record-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

const formSchema = z.object({
  name: z.string().trim().min(1, 'Give this project a name.').max(120, 'Keep the name under 120 characters.'),
  description: z.string().max(4000, 'Keep the description under 4,000 characters.'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a valid project color.'),
  icon: z.string().max(64),
  defaultCurrencyId: z.string().min(1, 'Choose a default currency.'),
});
type FormValues = z.infer<typeof formSchema>;
const palette = ['#47796A', '#B9795E', '#66869A', '#9C8050', '#7D7397', '#71834E'];
const projectIconOptions = [
  { value: 'FolderKanban', label: 'Folder', Icon: FolderKanban },
  { value: 'Plane', label: 'Travel', Icon: Plane },
  { value: 'House', label: 'Home', Icon: House },
  { value: 'Briefcase', label: 'Work', Icon: Briefcase },
  { value: 'Sparkles', label: 'Personal', Icon: Sparkles },
] as const;
const projectIconComponents = Object.fromEntries(
  projectIconOptions.map(({ value, Icon }) => [value, Icon]),
);

function ProjectMark({ name }: { name: string | null }) {
  const Icon =
    projectIconComponents[name as keyof typeof projectIconComponents] ?? FolderKanban;
  return <Icon size={21} strokeWidth={1.8} />;
}

const shortDate = formatDate;

/**
 * Refreshes the project lists after a write.
 *
 * `invalidateQueries` alone can be swallowed by a list fetch that was already in
 * flight when the mutation completed: the stale response then lands in the cache
 * and nothing refetches, so a newly created project stays invisible until a
 * reload. Cancelling first discards that in-flight response, and the refetch
 * guarantees fresh data.
 */
async function refreshProjectLists(
  queryClient: QueryClient,
  projectId?: string,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: getListProjectsQueryKey() });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() }),
    queryClient.refetchQueries({ queryKey: getListProjectsQueryKey() }),
    ...(projectId
      ? [queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) })]
      : []),
  ]);
}

function ProjectFormDialog({ open, onOpenChange, project }: {
  open: boolean; onOpenChange: (open: boolean) => void; project?: Project | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { activeCurrencies: currencies, isLoading: currenciesLoading } = useCurrencyOptions();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const isEditing = Boolean(project);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: project?.name ?? '',
      description: project?.description ?? '',
      color: project?.color ?? palette[0],
      icon: project?.icon ?? 'FolderKanban',
      defaultCurrencyId: project?.defaultCurrency?.id ?? '',
    },
  });

  // Dialog forms are mounted only while open, so current project values seed each new session.
  useEffect(() => {
    const current = form.getValues('defaultCurrencyId');
    if (current && currencies.some((currency) => currency.id === current)) return;
    const fallback = project?.defaultCurrency?.id ?? currencies[0]?.id ?? '';
    if (fallback && fallback !== current) {
      form.setValue('defaultCurrencyId', fallback, { shouldValidate: false });
    }
  }, [currencies, form, project]);

  const busy = createProject.isPending || updateProject.isPending;
  const onSubmit = (values: FormValues) => {
    if (project) {
      const data: ProjectUpdate = { name: values.name, description: values.description || null, color: values.color, icon: values.icon, defaultCurrencyId: values.defaultCurrencyId };
      updateProject.mutate({ projectId: project.id, data }, {
        onSuccess: async () => {
          await refreshProjectLists(queryClient, project.id);
          toast({ title: 'Project updated', description: 'Your changes are saved.' });
          onOpenChange(false);
        },
        onError: (error) => toast({ title: 'Could not update project', description: errorText(error), variant: 'destructive' }),
      });
      return;
    }
    const data: ProjectInput = { name: values.name, description: values.description || undefined, color: values.color, icon: values.icon, defaultCurrencyId: values.defaultCurrencyId };
    createProject.mutate({ data }, {
      onSuccess: async () => {
        await refreshProjectLists(queryClient);
        toast({ title: 'Project created', description: 'A new place for related expenses is ready.' });
        form.reset({ name: '', description: '', color: palette[0], icon: 'FolderKanban', defaultCurrencyId: currencies[0]?.id ?? '' });
        onOpenChange(false);
      },
      onError: (error) => toast({ title: 'Could not create project', description: errorText(error), variant: 'destructive' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] rounded-[24px] border-border bg-card p-6 sm:p-8" data-testid="dialog-project-form">
        <DialogHeader>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">{isEditing ? 'REFINE YOUR SPACE' : 'A NEW PLACE TO BEGIN'}</p>
          <DialogTitle className="font-display text-2xl tracking-[-.04em]">{isEditing ? 'Edit project' : 'Create a project'}</DialogTitle>
          <DialogDescription className="leading-6">Gather related spending under a name that means something to you. Categories stay shared across your whole account.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-2 space-y-5" data-testid="form-project">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Project name</FormLabel>
                <FormControl><Input {...field} autoFocus maxLength={120} placeholder="e.g. Kitchen refresh" data-testid="input-project-name" className="h-11 rounded-xl bg-background" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                <FormControl><Textarea {...field} maxLength={4000} rows={3} placeholder="A little context for future you…" data-testid="input-project-description" className="resize-y rounded-xl bg-background" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="defaultCurrencyId" render={({ field }) => (
              <FormItem>
                <FormLabel>Default currency <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <select
                    {...field}
                    aria-label="Default currency"
                    className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="select-project-currency"
                    disabled={currenciesLoading}
                  >
                    <option value="">{currenciesLoading ? 'Loading currencies…' : 'Choose a currency'}</option>
                    {currencies.map((currency) => (
                      <option key={currency.id} value={currency.id}>
                        {currency.symbol} {currency.code} · {currency.name}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <p className="text-[11px] text-muted-foreground" data-testid="text-project-currency-hint">
                  New expenses in this project start with this currency. Every expense keeps its own currency and nothing is converted.
                </p>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="color" render={({ field }) => (
              <FormItem>
                <FormLabel>Project color</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2.5" data-testid="group-project-colors">
                    {palette.map((color) => <button key={color} type="button" aria-label={`Choose ${color} project color`} aria-pressed={field.value === color} onClick={() => field.onChange(color)} className="grid size-9 place-items-center rounded-full border-2 transition-transform hover:scale-105" style={{ borderColor: field.value === color ? color : 'transparent' }} data-testid={`button-project-color-${color.slice(1)}`}><span className="size-6 rounded-full" style={{ backgroundColor: color }}>{field.value === color && <Check size={15} className="m-auto mt-[5px] text-white" />}</span></button>)}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="icon" render={({ field }) => (
              <FormItem>
                <FormLabel>Project icon</FormLabel>
                <FormControl>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Project icon" data-testid="group-project-icons">
                    {projectIconOptions.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        aria-label={`Choose ${label} icon`}
                        aria-pressed={field.value === value}
                        onClick={() => field.onChange(value)}
                        className={`grid size-10 place-items-center rounded-xl border transition-colors ${field.value === value ? 'border-primary bg-secondary text-primary' : 'border-border bg-background text-muted-foreground hover:text-primary'}`}
                        data-testid={`button-project-icon-${value}`}
                      >
                        <Icon size={17} />
                      </button>
                    ))}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-project">Cancel</Button>
              <Button type="submit" disabled={busy || currenciesLoading} className="gap-2" data-testid="button-save-project">
                {busy && <LoaderCircle size={15} className="animate-spin" />}{isEditing ? 'Save changes' : 'Create project'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectListPage() {
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [archiving, setArchiving] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const deleteProject = useDeleteProject();

  const confirmDelete = () => {
    if (!deleting) return;
    deleteProject.mutate({ projectId: deleting.id }, {
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setDeleting(null);
        toast({
          title: result.archived ? 'Project archived' : 'Project deleted',
          description: result.archived
            ? `${result.name} has ${result.usageCount} expense${result.usageCount === 1 ? '' : 's'}, so it was archived and they are untouched.`
            : `${result.name} was removed.`,
        });
      },
      onError: (error) => toast({
        title: 'Could not delete project',
        description: errorText(error),
        variant: 'destructive',
      }),
    });
  };
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const projectsQuery = useListProjects({ status });
  const archiveProject = useArchiveProject();

  const confirmArchive = () => {
    if (!archiving) return;
    const project = archiving;
    archiveProject.mutate({ projectId: project.id }, {
      onSuccess: async () => {
        await refreshProjectLists(queryClient, project.id);
        toast({ title: 'Project archived', description: `${project.name} is now in your archive.` });
        setArchiving(null);
      },
      onError: (error) => toast({ title: 'Could not archive project', description: errorText(error), variant: 'destructive' }),
    });
  };
  const startEdit = (project: Project) => { setEditing(project); setFormOpen(true); };

  return (
    <div className="page-enter">
      <div className="mb-8 text-[10px] font-bold uppercase tracking-[.19em] text-primary">SPENDING WITH PURPOSE</div>
      <div className="flex flex-col gap-5 border-b border-border/80 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[40px] font-semibold leading-none tracking-[-.055em] sm:text-[52px]" data-testid="heading-projects">Projects</h1>
          <p className="mt-4 max-w-[470px] text-[14px] leading-6 text-muted-foreground">Keep related expenses together around the things that matter.</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="h-11 gap-2 rounded-xl px-4" data-testid="button-new-project"><Plus size={16} /> New project</Button>
      </div>

      <div className="mt-7 flex items-center justify-between gap-4">
        <div className="flex rounded-xl bg-secondary/65 p-1" role="tablist" aria-label="Project status">
          {(['active', 'archived'] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={status === tab} onClick={() => setStatus(tab)} data-testid={`tab-projects-${tab}`} className={`min-h-9 rounded-lg px-4 text-xs font-bold capitalize transition-colors ${status === tab ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{tab}</button>)}
        </div>
        {!projectsQuery.isLoading && !projectsQuery.isError && <span className="text-xs text-muted-foreground" data-testid="text-project-count">{projectsQuery.data?.length ?? 0} {status} {projectsQuery.data?.length === 1 ? 'project' : 'projects'}</span>}
      </div>

      {projectsQuery.isLoading ? (
        <div className="mt-5 space-y-3" aria-label="Loading projects" data-testid="status-projects-loading">
          {[0, 1, 2].map((n) => <div key={n} className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-5"><Skeleton className="size-12 rounded-2xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-52" /></div><Skeleton className="h-8 w-20" /></div>)}
        </div>
      ) : projectsQuery.isError ? (
        <section className="mt-6 rounded-[22px] border border-destructive/25 bg-card px-6 py-9 text-center" data-testid="status-projects-error">
          <p className="font-display text-xl font-semibold">Your projects didn’t load.</p><p className="mt-2 text-sm text-muted-foreground">{errorText(projectsQuery.error)}</p>
          <Button onClick={() => projectsQuery.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-projects"><RotateCcw size={15} /> Try again</Button>
        </section>
      ) : projectsQuery.data?.length ? (
        <div className="mt-5 space-y-3" data-testid="list-projects">
          {projectsQuery.data.map((project, index) => (
            <article key={project.id} className="group relative flex flex-col gap-4 rounded-[20px] border border-border/70 bg-card px-4 py-4 transition-all hover:border-primary/25 hover:shadow-[0_12px_36px_-30px_var(--hover-shadow)] sm:flex-row sm:items-center sm:px-5" data-testid={`card-project-${project.id}`}>
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-[16px]" style={{ backgroundColor: `${project.color}1B`, color: project.color }} data-testid={`icon-project-${project.id}`}><ProjectMark name={project.icon} /></div>
                <div className="min-w-0">
                  <Link href={`/projects/${project.id}`} className="inline-flex max-w-full items-center gap-1.5 font-display text-[17px] font-semibold tracking-[-.025em] hover:text-primary" data-testid={`link-project-${project.id}`}>
                    <span className="truncate">{project.name}</span><ArrowUpRight size={14} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground" data-testid={`text-project-description-${project.id}`}>{project.description || 'A space for related spending'}</p>
                  <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground" data-testid={`text-project-default-currency-${project.id}`}>
                    <span data-testid={`text-project-default-currency-code-${project.id}`}>{project.defaultCurrency?.symbol} {project.defaultCurrency?.code}</span>
                    <span className="font-normal">default</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3 sm:justify-end sm:border-0 sm:pt-0">
                <div className="flex gap-6 sm:gap-8">
                  <div><p className="font-display text-[16px] font-semibold tracking-[-.03em]" data-testid={`text-project-spent-${project.id}`}>{formatTotals(project.totals)}</p><p className="mt-0.5 text-[10px] uppercase tracking-[.12em] text-muted-foreground">spent</p></div>
                  <div><p className="font-display text-[16px] font-semibold tracking-[-.03em]" data-testid={`text-project-expenses-${project.id}`}>{project.expenseCount}</p><p className="mt-0.5 text-[10px] uppercase tracking-[.12em] text-muted-foreground">expenses</p></div>
                </div>
                {status === 'active' ? <div className="flex items-center gap-1">
                  <button type="button" onClick={() => startEdit(project)} aria-label={`Edit ${project.name}`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary" data-testid={`button-edit-project-${project.id}`}><Pencil size={15} /></button>
                  <button type="button" onClick={() => setArchiving(project)} aria-label={`Archive ${project.name}`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground" data-testid={`button-archive-project-${project.id}`}><Archive size={15} /></button>
                  <button type="button" onClick={() => setDeleting(project)} aria-label={`Delete ${project.name}`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" data-testid={`button-delete-project-${project.id}`}><Trash2 size={15} /></button>
                  <Link href={`/projects/${project.id}`} aria-label={`View ${project.name}`} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary" data-testid={`button-view-project-${project.id}`}><ChevronRight size={17} /></Link>
                </div> : <Badge variant="secondary" className="gap-1.5 rounded-full px-2.5 py-1 text-[10px] capitalize"><Archive size={12} /> Archived</Badge>}
              </div>
              <span className="sr-only" data-testid={`text-project-order-${project.id}`}>{index + 1}</span>
            </article>
          ))}
        </div>
      ) : (
        <section className="mt-6 rounded-[24px] border border-dashed border-border bg-card/55 px-6 py-12 text-center sm:py-16" data-testid="status-projects-empty">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><FolderKanban size={21} /></div>
          <p className="mt-5 font-display text-[23px] font-semibold tracking-[-.04em]">{status === 'active' ? 'A place for what’s next.' : 'Nothing in the archive yet.'}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{status === 'active' ? 'Create a project to bring related expenses together. Your categories stay global and unchanged.' : 'Projects you archive will be kept here, ready whenever you need to revisit them.'}</p>
          {status === 'active' && <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="mt-6 gap-2" data-testid="button-create-first-project"><Plus size={16} /> Create your first project</Button>}
        </section>
      )}
      <ProjectFormDialog key={`${formOpen ? 'open' : 'closed'}-${editing?.id ?? 'new'}`} open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }} project={editing} />
      <DeleteRecordDialog
        open={Boolean(deleting)}
        kind="project"
        name={deleting?.name ?? ''}
        usageCount={deleting?.usageCount ?? 0}
        busy={deleteProject.isPending}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        onConfirm={confirmDelete}
      />
      <AlertDialog open={Boolean(archiving)} onOpenChange={(open) => { if (!open && !archiveProject.isPending) setArchiving(null); }}>
        <AlertDialogContent className="rounded-[22px] border-border bg-card" data-testid="dialog-archive-project">
          <AlertDialogHeader><AlertDialogTitle className="font-display text-xl tracking-[-.03em]">Archive {archiving?.name}?</AlertDialogTitle><AlertDialogDescription>This keeps its history and expenses intact. You can still find it from the Archived tab.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={archiveProject.isPending} data-testid="button-cancel-archive">Keep project</AlertDialogCancel><AlertDialogAction disabled={archiveProject.isPending} onClick={(event) => { event.preventDefault(); confirmArchive(); }} data-testid="button-confirm-archive">{archiveProject.isPending ? 'Archiving…' : 'Archive project'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProjectDetailPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [, navigate] = useLocation();
  const [formOpen, setFormOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const detailQuery = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: Boolean(projectId) } });
  const archiveProject = useArchiveProject();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteProject = useDeleteProject();
  const project = detailQuery.data?.project;

  const remove = () => {
    if (!project) return;
    deleteProject.mutate({ projectId: project.id }, {
      onSuccess: async (result) => {
        await refreshProjectLists(queryClient, project.id);
        setConfirmDelete(false);
        if (result.archived) {
          toast({
            title: 'Project archived',
            description: `${result.name} has ${result.usageCount} expense${result.usageCount === 1 ? '' : 's'}, so it was archived and they are untouched.`,
          });
          return;
        }
        toast({ title: 'Project deleted', description: `${result.name} was removed.` });
        navigate('/projects');
      },
      onError: (error) => toast({
        title: 'Could not delete project',
        description: errorText(error),
        variant: 'destructive',
      }),
    });
  };

  const archive = () => {
    if (!project) return;
    archiveProject.mutate({ projectId: project.id }, {
      onSuccess: async () => {
        await refreshProjectLists(queryClient, project.id);
        toast({ title: 'Project archived', description: `${project.name} is now in your archive.` });
        setConfirmArchive(false);
      },
      onError: (error) => toast({ title: 'Could not archive project', description: errorText(error), variant: 'destructive' }),
    });
  };
  const openEdit = () => {
    // A fresh detail object is used whenever the dialog opens.
    if (project) setFormOpen(true);
  };
  if (detailQuery.isLoading) return <div className="page-enter" data-testid="status-project-detail-loading"><Skeleton className="mb-5 h-3 w-32" /><Skeleton className="h-14 w-64" /><Skeleton className="mt-4 h-5 w-80" /><div className="mt-9 grid gap-4 sm:grid-cols-2"><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-36 rounded-2xl" /></div><Skeleton className="mt-7 h-56 rounded-2xl" /></div>;
  if (detailQuery.isError) {
    const statusCode = (detailQuery.error as { status?: number })?.status;
    const notFound = statusCode === 404;
    return <section className="page-enter flex min-h-[55vh] flex-col items-start justify-center" data-testid={notFound ? 'status-project-not-found' : 'status-project-detail-error'}>
      <span className="mb-4 text-[10px] font-bold uppercase tracking-[.19em] text-primary">{notFound ? 'NO PROJECT HERE' : 'A SMALL INTERRUPTION'}</span>
      <h1 className="font-display text-4xl font-semibold tracking-[-.055em]">{notFound ? 'This project isn’t here.' : 'Project details didn’t load.'}</h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{notFound ? 'It may have been removed or the address may be incorrect.' : errorText(detailQuery.error)}</p>
      {!notFound && <Button onClick={() => detailQuery.refetch()} variant="outline" className="mt-5 gap-2" data-testid="button-retry-project-detail"><RotateCcw size={15} /> Try again</Button>}
      <Link href="/projects" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline" data-testid="link-projects-from-error"><ArrowLeft size={15} /> All projects</Link>
    </section>;
  }
  if (!detailQuery.data || !project) return <section className="page-enter" data-testid="status-project-not-found"><h1 className="font-display text-3xl font-semibold">This project isn’t here.</h1><Link href="/projects" className="mt-5 inline-flex text-sm font-bold text-primary" data-testid="link-projects-from-empty-detail">Back to projects</Link></section>;
  const detail = detailQuery.data;
  const maxCategory = Math.max(...detail.categoryBreakdown.flatMap((item) => item.totals.map((entry) => Number(entry.total))), 1);
  const categoryTotal = (item: { totals: { total: string }[] }) => item.totals.reduce((sum, entry) => sum + Number(entry.total), 0);

  return (
    <div className="page-enter">
      <Link href="/projects" className="mb-7 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary" data-testid="link-back-projects"><ArrowLeft size={15} /> All projects</Link>
      <div className="flex flex-col gap-5 border-b border-border/80 pb-7 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="mt-1 grid size-12 shrink-0 place-items-center rounded-[16px]" style={{ color: project.color, backgroundColor: `${project.color}1B` }} data-testid="icon-project-detail"><ProjectMark name={project.icon} /></div>
          <div className="min-w-0"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">PROJECT OVERVIEW</div>
            <h1 className="break-words font-display text-[34px] font-semibold leading-tight tracking-[-.055em] sm:text-[44px]" data-testid="heading-project-detail">{project.name}</h1>
            <p className="mt-2 max-w-[580px] text-sm leading-6 text-muted-foreground" data-testid="text-project-detail-description">{project.description || 'A space for related spending, gathered in one place.'}</p>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground" data-testid="text-project-detail-default-currency">
              <span data-testid="text-project-detail-default-currency-code">{project.defaultCurrency?.symbol} {project.defaultCurrency?.code}</span>
              <span className="font-normal">default currency</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2 sm:pt-1">
          <Button variant="outline" onClick={openEdit} className="gap-2 rounded-xl" data-testid="button-edit-project-detail"><Pencil size={14} /> Edit</Button>
          {project.status === 'active' && <Button variant="outline" onClick={() => setConfirmArchive(true)} className="gap-2 rounded-xl" data-testid="button-archive-project-detail"><Archive size={14} /> Archive</Button>}
          <Button variant="outline" onClick={() => setConfirmDelete(true)} className="gap-2 rounded-xl text-destructive hover:text-destructive" data-testid="button-delete-project-detail"><Trash2 size={14} /> Delete</Button>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <section className="relative overflow-hidden rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="card-project-total-spent">
          <div className="absolute -right-6 -top-8 size-32 rounded-full border-[1px] border-primary/10" /><div className="absolute -right-1 -top-2 size-20 rounded-full border-[1px] border-primary/10" />
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground"><CircleDollarSign size={15} className="text-primary" /> Total spent</div>
          <p className="mt-5 font-display text-[36px] font-semibold leading-none tracking-[-.06em] sm:text-[42px]" data-testid="text-project-total-spent">{formatTotals(detail.totals)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Across all expenses in this project{detail.totals.length > 1 ? ' · multiple currencies' : ''}</p>
        </section>
        <section className="rounded-[22px] border border-border/70 bg-secondary/50 p-5 sm:p-6" data-testid="card-project-expense-count">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground"><Wallet size={15} className="text-primary" /> Expenses</div>
          <p className="mt-5 font-display text-[36px] font-semibold leading-none tracking-[-.06em] sm:text-[42px]" data-testid="text-project-expense-count">{detail.expenseCount}</p>
          <p className="mt-2 text-xs text-muted-foreground">{detail.expenseCount === 1 ? 'expense connected to this project' : 'expenses connected to this project'}</p>
        </section>
      </div>
      <div className="mt-7 grid gap-6 lg:grid-cols-[.88fr_1.12fr]">
        <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-project-category-breakdown">
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-[19px] font-semibold tracking-[-.035em]">Spending by category</h2><p className="mt-1 text-xs text-muted-foreground">Your global categories, viewed through this project.</p></div><Tag size={17} className="mt-1 text-primary" /></div>
          {detail.categoryBreakdown.length ? <div className="mt-6 space-y-5" data-testid="list-project-category-breakdown">
            {detail.categoryBreakdown.map((category) => <div key={category.categoryId} data-testid={`row-project-category-${category.categoryId}`}>
              <div className="mb-2 flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: category.categoryColor }} /><span className="truncate text-[13px] font-semibold" data-testid={`text-project-category-name-${category.categoryId}`}>{category.categoryName}</span><span className="text-[10px] text-muted-foreground">{category.expenseCount}</span></div><span className="shrink-0 text-[13px] font-semibold tabular-nums" data-testid={`text-project-category-spent-${category.categoryId}`}>{formatTotals(category.totals)}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max((categoryTotal(category) / maxCategory) * 100, 2)}%`, backgroundColor: category.categoryColor }} /></div>
            </div>)}
          </div> : <div className="mt-6 rounded-xl bg-secondary/45 px-4 py-6 text-center text-sm text-muted-foreground" data-testid="status-project-categories-empty">Category totals will appear when this project has expenses.</div>}
        </section>
        <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6" data-testid="section-project-recent-expenses">
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-[19px] font-semibold tracking-[-.035em]">Recent expenses</h2><p className="mt-1 text-xs text-muted-foreground">The latest entries connected to this project.</p></div><span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold text-secondary-foreground" data-testid="text-recent-expense-count">{detail.recentExpenses.length} recent</span></div>
          {detail.recentExpenses.length ? <div className="mt-4 divide-y divide-border/70" data-testid="list-project-recent-expenses">
            {detail.recentExpenses.map((expense) => <div key={expense.id} className="flex items-center gap-3 py-3.5" data-testid={`row-project-expense-${expense.id}`}>
              <div className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${expense.categoryColor}1B`, color: expense.categoryColor }}><span className="size-2 rounded-full" style={{ backgroundColor: expense.categoryColor }} /></div>
              <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold" data-testid={`text-expense-description-${expense.id}`}>{expense.description || expense.categoryName}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{expense.categoryName}<span className="mx-1.5">·</span>{shortDate(expense.date)}</p></div>
              <p className="shrink-0 text-[13px] font-semibold tabular-nums" data-testid={`text-expense-amount-${expense.id}`}>{money(expense.amount, expense.currency)}</p>
            </div>)}
          </div> : <div className="mt-5 rounded-xl bg-secondary/45 px-4 py-7 text-center" data-testid="status-project-expenses-empty"><p className="font-display text-base font-semibold">No expenses just yet</p><p className="mt-1.5 text-xs leading-5 text-muted-foreground">When an expense is linked to this project, it will show up here.</p></div>}
        </section>
      </div>
      {project.status === 'archived' && <div className="mt-6 flex items-center gap-2 rounded-xl border border-border/70 bg-secondary/40 px-4 py-3 text-xs text-muted-foreground" data-testid="status-project-archived"><Archive size={14} /> This project is archived. Its spending history remains available.</div>}
      <ProjectFormDialog key={`${formOpen ? 'open' : 'closed'}-${project.id}`} open={formOpen} onOpenChange={setFormOpen} project={project} />
      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent className="rounded-[22px] border-border bg-card" data-testid="dialog-archive-project-detail"><AlertDialogHeader><AlertDialogTitle className="font-display text-xl">Archive {project.name}?</AlertDialogTitle><AlertDialogDescription>This keeps the project’s history intact and moves it into your archive.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={archiveProject.isPending} data-testid="button-cancel-archive-detail">Keep project</AlertDialogCancel><AlertDialogAction disabled={archiveProject.isPending} onClick={(event) => { event.preventDefault(); archive(); }} data-testid="button-confirm-archive-detail">{archiveProject.isPending ? 'Archiving…' : 'Archive project'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export { ProjectListPage, ProjectDetailPage };