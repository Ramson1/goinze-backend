import { paginate } from '../../lib/utils';
import type { Paginated } from '../../../../lib/types';

interface PrismaDelegate {
  findMany(args?: any): Promise<any[]>;
  count(args?: any): Promise<number>;
}

interface PaginateArgs {
  page?: number;
  pageSize?: number;
  where?: Record<string, any>;
  orderBy?: Record<string, any> | Record<string, any>[];
  include?: Record<string, any>;
  select?: Record<string, any>;
}

/**
 * Run a paginated findMany + count against a Prisma model delegate and shape
 * the result into the shared `Paginated<T>` envelope.
 */
export async function paginated<T = any>(
  delegate: PrismaDelegate,
  args: PaginateArgs = {},
): Promise<Paginated<T>> {
  const { page, pageSize } = paginate(args.page ?? 1, args.pageSize ?? 20);
  const base = {
    where: args.where,
    include: args.include,
    select: args.select,
  };

  const [items, total] = await Promise.all([
    delegate.findMany({
      ...base,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: args.orderBy ?? { createdAt: 'desc' },
    }),
    delegate.count({ where: args.where }),
  ]);

  return {
    items: items as T[],
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
