import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto/create-attendance.dto';
import { Attendance } from './attendance.entity';

@Resolver()
export class AttendanceResolver {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Query(() => [Attendance], { name: 'getAttendanceByEmployeeIdToday' })
  async getAttendanceByEmployeeIdToday(
    @Args('employeeId', { type: () => Int }) employeeId: number,
  ) {
    return this.attendanceService.getAttendanceByEmployeeIdToday(employeeId);
  }

  @Query(() => [Attendance], { name: 'getAttendanceByDateRange' })
  async getAttendanceByDateRange(
    @Args('startDate', { type: () => String }) startDate: string,
    @Args('endDate', { type: () => String }) endDate: string,
  ) {
    return this.attendanceService.getAttendanceByDateRange(startDate, endDate);
  }

  @Query(() => [Attendance], { name: 'getAttendanceByEmployeeIdAndDateRange' })
  async getAttendanceByEmployeeIdAndDateRange(
    @Args('employeeId', { type: () => Int }) employeeId: number,
    @Args('startDate', { type: () => String }) startDate: string,
    @Args('endDate', { type: () => String }) endDate: string,
  ) {
    return this.attendanceService.getAttendanceByEmployeeIdAndDateRange(
      employeeId,
      startDate,
      endDate,
    );
  }

  @Mutation(() => Int)
  async createAttendance(@Args('input') input: CreateAttendanceDto) {
    return this.attendanceService.createAttendance(input);
  }
}
