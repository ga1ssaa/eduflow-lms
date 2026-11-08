import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { api } from '../../lib/api';
import { SelectControl } from '../SelectControl';

/** The API has no category facet endpoint; fetch summaries only on demand. */
async function publishedCategories(signal: AbortSignal) {
  const categories = new Set<string>();
  for (let page = 1; ; page++) {
    const result = await api.catalog({ page, page_size: 100 }, signal);
    for (const course of result.items) {
      if (course.category) categories.add(course.category);
    }
    if (!result.items.length || page * result.page_size >= result.total) break;
  }
  return [...categories].sort((a, b) => a.localeCompare(b));
}

export function CatalogFilters() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [categoriesRequested, requestCategories] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const categories = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: ({ signal }) => publishedCategories(signal),
    enabled: categoriesRequested,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const category = params.get('category') ?? '';
  const rawLevel = params.get('level') ?? '';
  const level = ['beginner', 'intermediate', 'advanced'].includes(rawLevel)
    ? rawLevel
    : '';
  const hasFilters = !!(search || category || rawLevel || params.get('search'));

  useEffect(() => {
    // Back/Forward restores the input and cancels a pending edit from the old URL.
    setSearch(new URLSearchParams(location.search).get('search') ?? '');
    return () => clearTimeout(timer.current);
  }, [location.key, location.search]);

  const apply = (changes: Record<string, string>) => {
    clearTimeout(timer.current);
    const next = new URLSearchParams(location.search);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    next.delete('page');
    if (next.toString() === params.toString()) return;
    navigate({
      pathname: location.pathname,
      search: next.toString() ? `?${next}` : '',
      hash: location.hash,
    });
  };

  return (
    <form
      className="catalog-filter"
      aria-label="Filter courses"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ search: search.trim() });
      }}
    >
      <label className="catalog-search">
        <span>Search courses</span>
        <div className="catalog-input-icon">
          <Search size={18} aria-hidden="true" />
          <input
            name="search"
            maxLength={200}
            value={search}
            placeholder="What would you like to learn?"
            onChange={(event) => {
              const value = event.target.value;
              setSearch(value);
              clearTimeout(timer.current);
              timer.current = setTimeout(
                () => apply({ search: value.trim() }),
                300,
              );
            }}
          />
        </div>
      </label>
      <label>
        <span>Category</span>
        <SelectControl
          name="category"
          value={category}
          onFocus={() => requestCategories(true)}
          onChange={(event) =>
            apply({ search: search.trim(), category: event.target.value })
          }
          aria-describedby={
            categories.isError ? 'catalog-category-error' : undefined
          }
        >
          <option value="">All categories</option>
          {category && !categories.data?.includes(category) && (
            <option value={category}>{category}</option>
          )}
          {categories.data?.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
          {categories.isFetching && (
            <option disabled>Loading categories…</option>
          )}
        </SelectControl>
        {categories.isError && (
          <span id="catalog-category-error" className="catalog-category-error">
            Categories unavailable.{' '}
            <button type="button" onClick={() => void categories.refetch()}>
              Retry
            </button>
          </span>
        )}
      </label>
      <label>
        <span>Level</span>
        <SelectControl
          name="level"
          value={level}
          onChange={(event) =>
            apply({ search: search.trim(), level: event.target.value })
          }
        >
          <option value="">All levels</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </SelectControl>
      </label>
      <button
        className="button secondary catalog-clear-filters"
        type="button"
        disabled={!hasFilters}
        onClick={() => {
          setSearch('');
          apply({ search: '', category: '', level: '' });
        }}
      >
        Clear filters <X size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
