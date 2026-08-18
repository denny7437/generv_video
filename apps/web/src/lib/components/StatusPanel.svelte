<script lang="ts">
  import type {
    GenerationJob,
    ImportJob,
    ImportStatus,
    JobStatus,
  } from '$lib/mock-api.js';

  let {
    importJob,
    generationJob,
    onreset,
  }: {
    importJob: ImportJob;
    generationJob: GenerationJob;
    onreset: () => void;
  } = $props();

  const importLabels: Record<ImportStatus, string> = {
    queued: 'В очереди',
    running: 'Импортируем карточку…',
    ready: 'Карточка готова',
    failed: 'Ошибка импорта',
  };

  const jobLabels: Record<JobStatus, string> = {
    queued: 'В очереди',
    running: 'Генерируем ролик…',
    ready: 'Ролик готов',
    qc_failed: 'Не прошёл контроль качества',
    failed: 'Ошибка генерации',
  };

  function dotClass(status: ImportStatus | JobStatus): string {
    if (status === 'ready') return 'bg-green-500';
    if (status === 'failed' || status === 'qc_failed') return 'bg-red-500';
    if (status === 'running') return 'bg-amber-500 animate-pulse';
    return 'bg-muted-foreground';
  }

  const importDot = $derived(dotClass(importJob.status));
  const jobDot = $derived(dotClass(generationJob.status));
</script>

<section class="rounded-xl border border-border bg-muted/40 p-6">
  <h2 class="text-lg font-semibold">Статус генерации</h2>

  <ul class="mt-5 space-y-4">
    <li class="flex items-start gap-3">
      <span class="mt-1 h-3 w-3 shrink-0 rounded-full {importDot}"></span>
      <div class="flex flex-col">
        <span class="text-sm font-medium">Импорт карточки</span>
        <span class="text-xs text-muted-foreground">
          {importLabels[importJob.status]}
          {#if importJob.cardId}<span class="ml-1">({importJob.cardId})</span>{/if}
        </span>
      </div>
    </li>

    <li class="flex items-start gap-3">
      <span class="mt-1 h-3 w-3 shrink-0 rounded-full {jobDot}"></span>
      <div class="flex flex-col">
        <span class="text-sm font-medium">Генерация ролика</span>
        <span class="text-xs text-muted-foreground">{jobLabels[generationJob.status]}</span>
      </div>
    </li>
  </ul>

  {#if generationJob.status === 'ready'}
    <div class="mt-5 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm">
      Ролик готов и прошёл контроль качества. Выдача появится после подключения реального API.
    </div>
  {/if}

  <button
    type="button"
    onclick={onreset}
    class="mt-5 w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
  >
    Загрузить ещё одну карточку
  </button>
</section>
