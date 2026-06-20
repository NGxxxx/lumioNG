<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import "../app.css";
  let { children } = $props();
</script>

{@render children()}
