<script lang="ts">
  import { page } from '$app/state';
</script>

<div class="flex flex-col items-center justify-center gap-4 py-16 text-center">
  <h1 class="text-4xl font-bold">{page.status}</h1>
  <p class="text-muted-foreground">
    {page.status === 404 ? 'Страница не найдена' : 'Что-то пошло не так'}
  </p>
  <a href="/" class="text-accent underline underline-offset-4">На главную</a>
</div>
