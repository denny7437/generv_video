<script lang="ts">
  import { recognizeMarketplaceLink } from '$lib/marketplace.js';
  import { validateFiles, validateLink } from '$lib/validate.js';
  import type { ImportSource } from '$lib/mock-api.js';

  let {
    onsubmit,
  }: {
    onsubmit: (source: ImportSource) => void;
  } = $props();

  let mode = $state<'link' | 'files'>('link');
  let link = $state('');
  let title = $state('');
  let files = $state<FileList | null>(null);
  let error = $state<string | null>(null);

  const photoCount = $derived(files ? files.length : 0);

  function handleSubmit() {
    error = null;
    if (mode === 'link') {
      const check = validateLink(link);
      if (!check.ok) {
        error = check.error ?? 'Проверьте ссылку';
        return;
      }
      const recognized = recognizeMarketplaceLink(link);
      if (!recognized) {
        error = 'Ссылка не распознана как карточка Ozon или Wildberries';
        return;
      }
      onsubmit({ kind: 'link', url: recognized.url, marketplace: recognized.marketplace });
    } else {
      const photoNames = files ? Array.from(files).map((f) => f.name) : [];
      const check = validateFiles(title, photoNames.length);
      if (!check.ok) {
        error = check.error ?? 'Проверьте заполнение полей';
        return;
      }
      onsubmit({ kind: 'files', title: title.trim(), photos: photoNames });
    }
  }
</script>

<section class="rounded-xl border border-border bg-muted/40 p-6">
  <h2 class="text-lg font-semibold">Загрузка карточки товара</h2>
  <p class="mt-1 text-sm text-muted-foreground">
    Вставьте ссылку на карточку Ozon/WB или загрузите фото вручную.
  </p>

  <div class="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1" role="tablist" aria-label="Способ загрузки">
    <button
      type="button"
      class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {mode === 'link'
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground'}"
      onclick={() => {
        mode = 'link';
        error = null;
      }}
      aria-pressed={mode === 'link'}
    >
      По ссылке
    </button>
    <button
      type="button"
      class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {mode === 'files'
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground'}"
      onclick={() => {
        mode = 'files';
        error = null;
      }}
      aria-pressed={mode === 'files'}
    >
      Из файлов
    </button>
  </div>

  <form class="mt-5 space-y-4" onsubmit={(e) => {
    e.preventDefault();
    handleSubmit();
  }}>
    {#if mode === 'link'}
      <div>
        <label for="card-link" class="mb-1 block text-sm font-medium">Ссылка на карточку</label>
        <input
          id="card-link"
          type="url"
          bind:value={link}
          placeholder="https://www.ozon.ru/product/…"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    {:else}
      <div>
        <label for="card-title" class="mb-1 block text-sm font-medium">Название товара</label>
        <input
          id="card-title"
          type="text"
          bind:value={title}
          placeholder="Например: Кроссовки беговые Nimbus 26"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <label for="card-photos" class="mb-1 block text-sm font-medium">Фото товара</label>
        <input
          id="card-photos"
          type="file"
          multiple
          accept="image/*"
          bind:files
          class="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-foreground"
        />
        <p class="mt-1 text-xs text-muted-foreground">Выбрано фото: {photoCount}</p>
      </div>
    {/if}

    {#if error}
      <p class="text-sm text-destructive" role="alert">{error}</p>
    {/if}

    <button
      type="submit"
      class="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90"
    >
      Запустить генерацию
    </button>
  </form>
</section>
