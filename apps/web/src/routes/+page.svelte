<script lang="ts">
  import { onDestroy } from 'svelte';
  import ImportForm from '$lib/components/ImportForm.svelte';
  import StatusPanel from '$lib/components/StatusPanel.svelte';
  import {
    createMockApi,
    type GenerationJob,
    type ImportJob,
    type ImportSource,
  } from '$lib/mock-api.js';

  const api = createMockApi();

  let importJob = $state<ImportJob | null>(null);
  let generationJob = $state<GenerationJob | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function handleSubmit(source: ImportSource) {
    importJob = await api.createImport(source);
    generationJob = await api.createOrder();
    startPolling();
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (importJob) {
        importJob = (await api.getImport(importJob.id)) ?? importJob;
      }
      if (generationJob) {
        generationJob = (await api.getJob(generationJob.jobId)) ?? generationJob;
      }
      if (generationJob?.status === 'ready') {
        stopPolling();
      }
    }, 250);
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function reset() {
    stopPolling();
    importJob = null;
    generationJob = null;
  }

  onDestroy(stopPolling);
</script>

<svelte:head>
  <title>Нейровидео — кабинет селлера</title>
</svelte:head>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold">Кабинет селлера</h1>
    <p class="mt-1 text-sm text-muted-foreground">
      Фото товара → вертикальный ролик для карточки маркетплейса.
    </p>
  </div>

  {#if importJob && generationJob}
    <StatusPanel {importJob} {generationJob} onreset={reset} />
  {:else}
    <ImportForm onsubmit={handleSubmit} />
  {/if}
</div>
