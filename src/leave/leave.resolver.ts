import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { LeaveService } from './leave.service';
import { Leave, LeaveType } from './leave.type';
import { LeaveEntity } from './leave.entity';

@Resolver(() => Leave)
export class LeaveResolver {
  constructor(private readonly leaveService: LeaveService) {}

  @Query(() => [LeaveEntity])
  async leaves(
    @Args('employee_id', { type: () => Int, nullable: true })
    employeeId?: number,
  ) {
    return this.leaveService.getLeaves(employeeId);
  }

  @Query(() => [LeaveType])
  async leaveTypes() {
    return this.leaveService.getLeaveTypes();
  }

  @Query(() => LeaveEntity)
  async leave(@Args('id', { type: () => Int }) id: number) {
    return this.leaveService.getLeaveById(id);
  }

  @Mutation(() => LeaveEntity)
  async createLeaveRequest(
    @Args('employee_id', { type: () => Int }) employeeId: number,
    @Args('holiday_status_id', { type: () => Int }) holidayStatusId: number,
    @Args('request_date_from') requestDateFrom: string,
    @Args('request_date_to') requestDateTo: string,
    @Args('notes', { nullable: true }) notes: string,
  ) {
    return this.leaveService.createLeaveRequest(
      employeeId,
      holidayStatusId,
      requestDateFrom,
      requestDateTo,
      notes,
    );
  }

  @Mutation(() => LeaveEntity)
  async approveLeaveRequest(@Args('id', { type: () => Int }) id: number) {
    return this.leaveService.approveLeaveRequest(id);
  }

  @Mutation(() => LeaveEntity)
  async refuseLeaveRequest(@Args('id', { type: () => Int }) id: number) {
    return this.leaveService.refuseLeaveRequest(id);
  }
}
