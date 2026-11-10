import { Controller, Get, Query } from '@nestjs/common';
import type { SearchResponse } from '@dzenwriter/shared';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@Query('q') query: string | undefined): Promise<SearchResponse> {
    return this.search.search(query ?? '');
  }
}
