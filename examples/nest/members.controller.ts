import { Controller, Get, Injectable, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';

export interface Member {
  id: number;
  name: string;
}

/** Where members come from. In a real app this talks to the database; tests replace it. */
@Injectable()
export class MembersService {
  async findOne(id: number): Promise<Member> {
    throw new NotFoundException(`Member #${id} not found`);
  }
}

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Member> {
    return this.members.findOne(id);
  }
}
