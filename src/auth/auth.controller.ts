import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '../../lib/types';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IpAddress } from '../common/decorators/ip-address.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @IpAddress() ip: string) {
    return this.authService.login(dto, ip);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout() {
    return this.authService.logout();
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return this.authService.me(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(
    @CurrentUser() user: SessionUser,
    @Body() dto: UpdateProfileDto,
    @IpAddress() ip: string,
  ) {
    return this.authService.updateProfile(user.id, dto, ip);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  changePassword(
    @CurrentUser() user: SessionUser,
    @Body() dto: ChangePasswordDto,
    @IpAddress() ip: string,
  ) {
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      ip,
    );
  }
}
