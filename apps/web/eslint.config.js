// Next's own lint step runs during `next build`. The repo-wide ESLint config at the root
// already covers these files with type-aware rules, so this exists only to stop Next
// running a second, differently-configured pass over them.
export default [];
