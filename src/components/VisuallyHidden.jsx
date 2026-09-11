/**
 * Renders text for assistive technology only.
 *
 * Uses clip-based hiding rather than `display: none`, which would remove the
 * content from the accessibility tree entirely. When `focusable` is set the
 * content becomes visible on keyboard focus (used for the skip link).
 */
function VisuallyHidden({ as: Tag = 'span', focusable = false, children, ...rest }) {
  return (
    <Tag className={focusable ? 'sr-only focus:not-sr-only' : 'sr-only'} {...rest}>
      {children}
    </Tag>
  )
}

export default VisuallyHidden
