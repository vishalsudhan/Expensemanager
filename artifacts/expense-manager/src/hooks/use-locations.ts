import { useMemo } from 'react';
import { useListCategories, useListLocations } from '@workspace/api-client-react';
import type { Category, Location } from '@workspace/api-client-react';

/**
 * Locations are a first-class dimension and independent of project, category and
 * currency. Nothing here infers one from another.
 */
export function useLocations(): {
  locations: Location[] | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const query = useListLocations({ status: 'active' });
  return { locations: query.data, isLoading: query.isLoading, isError: query.isError };
}

export interface CategoryNode {
  category: Category;
  children: Category[];
}

export interface CategoryTree {
  /** Top-level categories, each with its subcategories nested. */
  roots: CategoryNode[];
  /** Flat id -> category lookup for O(1) resolution. */
  byId: Map<string, Category>;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Nests the flat category list into parents + children.
 *
 * A category whose parent is missing (e.g. a parent was archived) is promoted to
 * a root rather than hidden, so nothing becomes unselectable.
 */
export function useCategoryTree(): CategoryTree {
  const query = useListCategories({ status: 'active' });
  const categories = query.data;

  const { roots, byId } = useMemo(() => {
    const byId = new Map<string, Category>();
    for (const category of categories ?? []) byId.set(category.id, category);

    const childGroups = new Map<string, Category[]>();
    const roots: CategoryNode[] = [];

    for (const category of categories ?? []) {
      if (category.parentId && byId.has(category.parentId)) {
        const siblings = childGroups.get(category.parentId) ?? [];
        siblings.push(category);
        childGroups.set(category.parentId, siblings);
      }
    }

    for (const category of categories ?? []) {
      if (category.parentId && byId.has(category.parentId)) continue;
      roots.push({
        category,
        children: (childGroups.get(category.id) ?? []).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      });
    }

    roots.sort((a, b) => a.category.name.localeCompare(b.category.name));
    return { roots, byId };
  }, [categories]);

  return { roots, byId, isLoading: query.isLoading, isError: query.isError };
}

/** Finds the parent node for a category, or null for a top-level category. */
export function parentOf(tree: CategoryTree, categoryId: string): Category | null {
  const category = tree.byId.get(categoryId);
  if (!category?.parentId) return null;
  return tree.byId.get(category.parentId) ?? null;
}

/** Display label such as "Food & Dining / Groceries". */
export function categoryPath(tree: CategoryTree, categoryId: string): string {
  const category = tree.byId.get(categoryId);
  if (!category) return 'Unknown';
  const parent = parentOf(tree, categoryId);
  return parent ? `${parent.name} / ${category.name}` : category.name;
}