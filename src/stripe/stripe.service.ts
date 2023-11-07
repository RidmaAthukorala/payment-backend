import { ForbiddenException, Injectable } from '@nestjs/common';
import { CreateStripeSubscriptionDto } from './dtos/createStripeSubscription.dto';
import { UserRepository } from './repositories/user.repository';
import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import { StripeRepository } from './repositories/stripe.repository';
import { CreateUserDto } from './dtos/createUser.dto';
import { PaymentRepository } from './repositories/payment.repository';
import { PaymentMethod, PaymentType, Status } from './types/payment.types';
import raw from 'raw-body';

@Injectable()
export class StripeService {
  private stripe: Stripe;

  constructor(
    private configService: ConfigService,
    private readonly userRepository: UserRepository,
    private readonly stripeRepository: StripeRepository,
    private readonly paymentRepository: PaymentRepository,
  ) {
    this.stripe = new Stripe(this.configService.get<string>('STRIPE_SK'), {
      apiVersion: '2023-08-16',
    });
  }

  async createUser(createUserDto: CreateUserDto) {
    const createdUser = await this.userRepository.createUser(createUserDto);

    if (createdUser) {
      return createUserDto;
    }
  }

  async createMembership(
    createStripeSubscriptionDto: CreateStripeSubscriptionDto,
  ) {
    const {
      userId,
      amount,
      paymentMethodId,
      paymentType,
      priceId,
      country_code,
      savePaymentMethod,
    } = createStripeSubscriptionDto;

    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new ForbiddenException(`User not found`);
    }

    if (!user.stripe_customer_id || user.stripe_customer_id === '') {
      const createdCustomerId = await this.stripeRepository.createCustomerId();

      if (createdCustomerId) {
        await this.userRepository.updateUserStripeCustomerId(
          createdCustomerId,
          user,
        );
      }
    }

    const updatedUser = await this.userRepository.findById(userId);

    const customer = await this.stripeRepository.retrieveCustomer(
      updatedUser.stripe_customer_id,
    );

    // const createdPaymentMethod =
    // const createdPaymentMethod =
    //   await this.stripeRepository.createPaymentMethod();

    // console.log(createdPaymentMethod, 'createdPaymentMethod');

    if (updatedUser.stripe_customer_id) {
      await this.stripeRepository.attachPaymentMethodId(
        paymentMethodId,
        updatedUser.stripe_customer_id,
      );
    }

    const { default_source } = customer;

    if (paymentMethodId !== default_source) {
      const updatedDefaultPaymentMethod =
        await this.stripeRepository.updateDefaultPaymentmethod(
          updatedUser.id,
          paymentMethodId,
        );

      if (updatedDefaultPaymentMethod) {
        await this.userRepository.updateUserStripeDefaultPaymentMethod(
          updatedDefaultPaymentMethod.id,
          user,
        );
      }
    }

    const defaultPaymentMethodUpdatedUser =
      await this.userRepository.findById(userId);

    // Making payment subscription
    const subscriptionIntent = await this.stripeRepository.createSubscription(
      defaultPaymentMethodUpdatedUser,
    );

    if (subscriptionIntent) {
      const payment = await this.paymentRepository.createPayment({
        user: defaultPaymentMethodUpdatedUser,
        payment_id: subscriptionIntent?.id,
        amount: +subscriptionIntent.items.data[0].plan.amount / 100,
        payment_method: PaymentMethod.STRIPE,
        payment_type: PaymentType.YEARLY,
        expire_date: new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000,
        ).toString(),
        create_date: subscriptionIntent.current_period_start.toString(),
        status: Status.PENDING,
        invoice_id:
          typeof subscriptionIntent?.latest_invoice == 'string'
            ? subscriptionIntent?.latest_invoice
            : typeof subscriptionIntent?.latest_invoice == 'object'
            ? (subscriptionIntent.latest_invoice as Stripe.Invoice)?.id
            : '',
      });

      if (!payment) {
        throw new Error(`payment not saved`);
      }

      return subscriptionIntent;
    }
  }

  async handleSubscriptionWebhook(data: Buffer, sig: string) {
    const membershipId = 1;

    const event = this.stripe.webhooks.constructEvent(
      data,
      sig,
      this.configService.get<string>('STRIPE_WEBHOOK_ENDPOINT_SK'),
    );

    if (!event?.id) {
      console.log(
        `event id not found eventId=${event?.id} time=${new Date().getTime()}`,
      );
      return;
    }
    const defaultPaymentMethodUpdatedUser = await this.userRepository.findById(
      `5600b6d6-3f8f-49b6-8938-3aafc9e24c25`,
    );
    const callbackData = JSON.parse(data.toString());
    console.log(event.type);
    switch (event.type) {
      case 'customer.subscription.created':
        console.log('customer.subscription.created'.toUpperCase());

        //check subscription id
        if (!callbackData.data.object?.id) {
          console.log(
            `subscription id not found eventId=${event?.id} subscriptionId=${callbackData
              .data.object
              ?.id} event=${`customer.subscription.created`}  time=${new Date().getTime()}`,
          );
          return;
        }
        //update payment table
        const payment_cancel = await this.paymentRepository.findOneByPaymentId(
          callbackData.data.object?.id,
        );
        if (!payment_cancel[0]?.id) {
          console.log(
            `payment id not found eventId=${event?.id} subscriptionId=${callbackData
              .data.object?.id} userId=${payment_cancel[0].user
              ?.id} event=${`customer.subscription.deleted`} time=${new Date().getTime()}`,
          );
          return;
        }
        this.paymentRepository
          .updatePayment(payment_cancel[0], Status.CANCELLED)
          .then(async (res) => {
            const user = await this.userRepository.findById(
              payment_cancel[0].user?.id,
            );
            if (!user?.id) {
              console.log(
                `user id not found eventId=${event?.id} subscriptionId=${callbackData
                  .data.object?.id} userId=${payment_cancel[0].user
                  ?.id} event=${`customer.subscription.deleted`} time=${new Date().getTime()}`,
              );
              return;
            }

            user.stripe_customer_id = '';
            user.stripe_default_payment_method = '';
            await this.userRepository
              .updateUser(user)
              .then((res) => {
                console.log(
                  `user updated ${res?.id} eventId=${event?.id} subscriptionId=${callbackData
                    .data.object?.id} userId=${payment_cancel[0].user
                    ?.id}  event=${`customer.subscription.deleted`} time=${new Date().getTime()}`,
                );
              })
              .catch((error) => {
                console.log(
                  `user update error_${res?.id} eventId=${event?.id} subscriptionId=${callbackData
                    .data.object?.id} userId=${payment_cancel[0].user
                    ?.id}  event=${`customer.subscription.deleted`} time=${new Date().getTime()} error=${error}`,
                );
              });
            //mail
            console.log(
              `payment status updated ${payment_cancel[0].payment_id} ${
                Status.CANCELLED
              } eventId=${event?.id} subscriptionId=${callbackData.data.object
                ?.id} userId=${payment_cancel[0].user
                ?.id}  event=${`customer.subscription.deleted`} time=${new Date().getTime()}`,
            );
          })
          .catch((error) => {
            console.log(
              `Payment status update error ${payment_cancel[0].payment_id} ${
                Status.CANCELLED
              } userId=${payment_cancel[0].user
                ?.id} time=${new Date().getTime()} error=${error}`,
            );
          });
        break;

      //-------------------------------------------------------------

      case 'customer.subscription.updated':
        console.log('customer.subscription.updated'.toUpperCase());

        if (!callbackData.data.object?.id) {
          console.log(
            `subscription id not found eventId=${event?.id} subscriptionId=${callbackData
              .data.object
              ?.id} event=${`customer.subscription.updated`}  time=${new Date().getTime()}`,
          );
          return;
        }
        if (callbackData.data.object.status !== 'active') {
          console.log(
            `subscription status not active eventId=${event?.id} subscriptionId=${callbackData
              .data.object
              ?.id} event=${`customer.subscription.updated`}  time=${new Date().getTime()}`,
          );
          return;
        }
        console.log(
          callbackData.data.object,
          'customer.subscription.updated event',
        );
        const payment_updated = await this.paymentRepository.findOneByPaymentId(
          callbackData.data.object?.id,
        );

        if (!payment_updated[0]?.id) {
          console.log(
            `payment id not found eventId=${event?.id} userId=${payment_updated[0]
              .user?.id} subscriptionId=${callbackData.data.object
              ?.id} event=${`customer.subscription.updated`}  time=${new Date().getTime()}`,
          );
          return;
        }
        //please check this is correct
        payment_updated[0].invoice_id =
          callbackData.data.object?.latest_invoice;
        this.paymentRepository
          .updatePayment(payment_updated[0], Status.ACTIVE)
          .then(async (payment_res) => {
            console.log(
              `Payment status updated eventId=${event?.id} userId=${payment_updated[0]
                .user?.id} subscriptionId=${callbackData.data.object
                ?.id} event=${`customer.subscription.updated`} status=${
                Status.ACTIVE
              } time=${new Date().getTime()} `,
            );
            const user = await this.userRepository.findById(
              payment_updated[0].user?.id,
            );
            // const membership = await this.membershipRepository.findById(
            //   membershipId,
            // );
            // if (!membership) {
            //   console.log(
            //     `membership id not found eventId=${event?.id} subscriptionId=${
            //       callbackData.data.object?.id
            //     } userId=${
            //       payment_updated[0].user?.id
            //     } event=${`customer.subscription.updated`}  time=${new Date().getTime()}`,
            //   );
            //   throw new NotFoundException(
            //     `Not found membership id ${membershipId}`,
            //   );
            // }

            await this.userRepository
              .updateUser(user)
              .then((res) => {
                const subscription = callbackData.data.object;
                const prevoiusSubscription =
                  callbackData.data.previous_attributes;
                console.log(
                  `user updated eventId=${event?.id} userId=${payment_updated[0]
                    .user?.id} subscriptionId=${callbackData.data.object
                    ?.id} event=${`customer.subscription.updated`} time=${new Date().getTime()} `,
                );
                if (
                  subscription.current_period_end >
                  prevoiusSubscription.current_period_end
                ) {
                  //callbackData.data.object.latest_invoice is the correct invoice Id. the  MailRenewalCompleted Invoice Id Should update with this email

                  // this.mailService.MailRenewalCompleted(
                  //   res,
                  //   payment_res,
                  //   membership,
                  //   callbackData.data.object?.latest_invoice,
                  // );
                  console.log(
                    `MailRenewalCompleted eventId=${event?.id} userId=${payment_updated[0]
                      .user?.id} subscriptionId=${callbackData.data.object
                      ?.id} event=${`customer.subscription.updated`} time=${new Date().getTime()} `,
                  );
                }
              })
              .catch((error) => {
                console.log(
                  `user update error eventId=${event?.id} userId=${payment_updated[0]
                    .user?.id} subscriptionId=${callbackData.data.object
                    ?.id} event=${`customer.subscription.updated`}  time=${new Date().getTime()} error=${error} `,
                );
              });
          })
          .catch((error) => {
            console.log(
              `Payment status update error eventId=${event?.id} userId=${payment_updated[0]
                .user?.id} subscriptionId=${callbackData.data.object
                ?.id} event=${`customer.subscription.updated`} time=${new Date().getTime()} error=${error} `,
            );
          });

      //-------------------------------------------------------------------

      case 'invoice.payment_failed':
        console.log('invoice.payment_failed'.toUpperCase());

        console.log(
          `invoice_created_return_0 ${
            typeof callbackData.data.object == 'object'
              ? (callbackData.data.object as Stripe.Invoice)?.id
              : callbackData.data.object
          }`,
        );
        // const a:any
        // console.log(a.period_end)
        // console.log(a.period_start)
        console.log(`with await ${await callbackData.data.object}`);
        console.log(`without await ${callbackData.data.object}`);
        if (!(callbackData.data.object as Stripe.Invoice)?.id) {
          console.log(
            `callbackData.data.object not found ${
              typeof callbackData.data.object == 'object'
                ? (callbackData.data.object as Stripe.Invoice)?.id
                : callbackData.data.object
            }`,
          );
          return;
        }

        console.log(
          `invoice_created_return_1 ${
            typeof callbackData.data.object == 'object'
              ? (callbackData.data.object as Stripe.Invoice)?.id
              : callbackData.data.object
          }`,
        );
        const {
          amount_paid,
          id,
          customer_email,
          hosted_invoice_url,
          status,
          created,
          subscription,
        } = callbackData.data.object as Stripe.Invoice;
        console.log(`invoice_created_return_2 , ${hosted_invoice_url}`);
        // if (!subscription) {
        //   this.logger.warn(`subscription not found for InvoiceId=${id}`);
        // }
        console.log(`invoice_created_return_3`);
        const invoiceId =
          typeof callbackData.data.object == 'object'
            ? (callbackData.data.object as Stripe.Invoice)?.id
            : callbackData.data.object;
        console.log(`invoice_created_return_4 ${invoiceId}`);
        console.log(
          `subscription id======${
            typeof subscription == 'string'
              ? subscription
              : (subscription as Stripe.Subscription)?.id
          }`,
        );

        const payment = await this.paymentRepository.findOneByPaymentId(
          typeof subscription == 'string'
            ? subscription
            : (subscription as Stripe.Subscription)?.id,
        );
        if (!payment[0].id) {
          console.log(
            `Payment not found event=nvoice.created subscriptionId=${
              typeof subscription == 'string'
                ? subscription
                : (subscription as Stripe.Subscription)?.id
            }`,
          );
        }

        break;

      //-------------------------------------------------------------
      case 'invoice.payment_succeeded':
        console.log('invoice.payment_succeeded'.toUpperCase());

        console.log(
          `invoice created ${
            (new Date(),
            typeof callbackData.data.object == 'object'
              ? (callbackData.data.object as Stripe.Invoice)?.id
              : callbackData.data.object)
          } status=${(callbackData.data.object as Stripe.Invoice)?.status}`,
        );
        if (!callbackData.data?.object?.subscription) {
          console.log(
            `subscription id not found eventId=${event?.id} subscriptionId=${callbackData
              ?.data?.object
              ?.id} event=${`invoice.payment_succeeded`}  time=${new Date().getTime()}`,
          );
          return;
        }
        if (callbackData?.data?.object?.status !== 'paid') {
          console.log(
            `subscription status not paid eventId=${event?.id} subscriptionId=${callbackData
              ?.data?.object
              ?.id} event=${`invoice.payment_succeeded`}  time=${new Date().getTime()}`,
          );
          return;
        }
        //update payment table
        const payment_succeeded =
          await this.paymentRepository.findOneByPaymentId(
            callbackData.data?.object?.subscription,
          );

        if (!payment_succeeded[0]?.id) {
          console.log(
            `payment id not found eventId=${event?.id} userId=${payment_succeeded[0]
              .user?.id} subscriptionId=${callbackData.data.object
              ?.id} event=${`invoice.payment_succeeded`}  time=${new Date().getTime()}`,
          );
          return;
        }

        await this.paymentRepository.updatePayment(
          payment_succeeded[0],
          Status.ACTIVE,
        );
        const user = await this.userRepository.findById(
          payment_succeeded[0].user?.id,
        );
        const updatedUser = await this.userRepository.updateUser(user);

        if (updatedUser) {
          console.log(
            `MailPaymentComplete eventId=${event?.id} userId=${payment_succeeded[0]
              .user?.id} subscriptionId=${callbackData.data.object
              ?.id} event=${`invoice.payment_succeeded`} time=${new Date().getTime()} `,
          );
        }
        break;

      //-------------------------------------------------------------
      // ONE -Time payment
      case 'payment_intent.succeeded':
        // Handle a successful payment

        await this.paymentRepository.createPayment({
          user: defaultPaymentMethodUpdatedUser,
          payment_id: event.data.object?.id,
          amount: +event.data.object.amount / 100,
          payment_method: PaymentMethod.STRIPE,
          payment_type: PaymentType.ONETIME,
          expire_date: new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000,
          ).toString(),
          create_date: event.data.object.created.toString(),
          status: Status.PENDING,
          invoice_id: event.data.object?.latest_charge.toString(),
        });
        console.log('Payment succeeded:', event.data.object);
        break;
      case 'charge.succeeded':
        // Handle a successful charge
        const get_payment = await this.paymentRepository.findOneByPaymentId(
          event.data.object?.payment_intent.toString(),
        );
        await this.paymentRepository.updatePayment(
          get_payment[0],
          Status.ACTIVE,
        );

        console.log('Charge succeeded:', event.data.object);
        // You can add your custom logic here, like updating your database or sending a confirmation email to the customer.
        break;

      case 'charge.failed':
        // Handle a failed charge
        await this.paymentRepository.updatePayment(
          get_payment[0],
          Status.CANCELLED,
        );
        console.log('Charge failed:', event.data.object);
        // You might want to notify the customer or take other appropriate actions.
        break;

      case 'checkout.session.expired':
        // Handle a failed charge
        await this.paymentRepository.updatePayment(
          get_payment[0],
          Status.EXPIRED,
        );
        console.log('Charge failed:', event.data.object);
        // You might want to notify the customer or take other appropriate actions.
        break;

      case 'payment_intent.payment_failed':
        // Handle a failed payment
        console.log('Payment failed:', event.data.object);
        break;

      //-------------------------------------------------------------
    }
  }
}
