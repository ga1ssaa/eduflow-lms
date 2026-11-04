import { Link, useLocation, type LinkProps } from 'react-router-dom';

// Keep section navigation in router history without discarding active filters.
export function CatalogAnchor({
  hash,
  ...props
}: Omit<LinkProps, 'to'> & { hash: `#${string}` }) {
  const { pathname, search } = useLocation();
  return <Link {...props} to={{ pathname, search, hash }} />;
}
