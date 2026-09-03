import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';
import { RemarksModule } from '../remarks/remarks.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RemarkGateway } from './remark.gateway';

/** GatewayModule (docs/ENGINEERING.md): WS комнаты, без своей бизнес-логики. */
@Module({
  imports: [AuthModule, TenancyModule, RemarksModule, AgentModule],
  providers: [RemarkGateway],
})
export class GatewayModule {}
