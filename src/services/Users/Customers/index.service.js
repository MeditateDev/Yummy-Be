const { Customer, Order } = require("../../../models/index.model");

class CustomerService {
  static getAllOrderForCustomer = async ({ user_id }) => {
    const Order = await Customer.findAll({
      where: { user_id: user_id },
      includes: [
        {
          model: Order,
        },
      ],
    });
    return await Order.Customer.Order;
  };
  static getOrderForCustomer = async ({ user_id, order_id }) => {
    const Customer = await Customer.findOne({ where: { user_id: user_id } });
    return await Order.findOne({
      where: { customer_id: Customer.id, id: order_id },
    });
  };
}

module.exports = CustomerService;
