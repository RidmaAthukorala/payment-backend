import { Body, Controller, Post, Headers, Get } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { CreateStripeSubscriptionDto } from './dtos/createStripeSubscription.dto';
import { PaymentType } from './types/payment.types';
import { CreateUserDto } from './dtos/createUser.dto';
import { BodyDto } from './dtos/body.dto';

@Controller('stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  // Create user
  // URL : /stripe/create-user
  @Post('create-user')
  async createUser() {
    const createUserDto: CreateUserDto = {
      first_name: 'Ridma',
      last_name: 'Athukorala',
      email: 'ridma@sonicdevs.com',
      password: 'R1dm@123@',
    };

    const createdUser = await this.stripeService.createUser(createUserDto);

    if (createdUser) {
      return {
        success: true,
        message: 'User created',
      };
    }
  }

  // Create subscription controller
  // URL : /stripe/create-subscription
  @Post('create-subscription')
  async createSubscription(@Body() bodyDto: BodyDto) {
    const createStripeSubscriptionDto: CreateStripeSubscriptionDto = {
      userId: '5600b6d6-3f8f-49b6-8938-3aafc9e24c25',
      amount: 50,
      paymentMethodId: bodyDto.id,
      paymentType: PaymentType.MONTHLY,
      priceId: 'priceIdNo123',
      country_code: 'LK',
      savePaymentMethod: true,
    };

    return await this.stripeService.createMembership(
      createStripeSubscriptionDto,
    );
  }

  // Listen to webhook
  // URL : /stripe/subscription-webhook
  @Post(`subscription-webhook`)
  async handleSubscriptionWebhook(
    @Body() data: any,
    @Headers('stripe-signature') sig: string,
  ) {
    return await this.stripeService.handleSubscriptionWebhook(data, sig);
  }
}
