<script lang="ts">
  import { Switch } from 'bits-ui';
  import { getTheme, toggle } from '$lib/theme.svelte.js';

  let checked = $state(getTheme() === 'dark');

  function onCheckedChange(next: boolean) {
    if (next !== (getTheme() === 'dark')) {
      toggle();
    }
  }
</script>

<label class="flex items-center gap-2">
  <span class="text-sm text-muted-foreground">Тёмная тема</span>
  <Switch.Root
    bind:checked
    onCheckedChange={onCheckedChange}
    aria-label="Переключить тёмную тему"
    class="inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border bg-muted transition-colors data-[state=checked]:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  >
    <Switch.Thumb
      class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-1"
    />
  </Switch.Root>
</label>
