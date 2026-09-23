import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemarksModule } from '../remarks/remarks.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RemarkGateway } from './remark.gateway';

/** GatewayModule (docs/ENGINEERING.md): WS комнаты (замечания и личная `user:{id}`, ADR 016), без своей бизнес-логики. */
@Module({
  imports: [AuthModule, TenancyModule, RemarksModule, AgentModule, NotificationsModule],
  providers: [RemarkGateway],
})
export class GatewayModule {}
