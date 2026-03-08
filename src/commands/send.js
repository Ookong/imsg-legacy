const MessageSender = require('../lib/sender');

/**
 * Send command - Send a message
 */
module.exports = function(program) {
  program
    .command('send')
    .description('Send a message')
    .requiredOption('-t, --to <recipient>', 'Recipient (phone number or email)')
    .option('-m, --text <message>', 'Message text', '')
    .option('-f, --file <path>', 'Attachment file path')
    .option('-s, --service <service>', 'Service (imessage|sms|auto)', 'auto')
    .option('-r, --region <code>', 'Region for phone normalization', 'US')
    .option('--chat-identifier <id>', 'Target chat by identifier')
    .option('--chat-guid <guid>', 'Target chat by GUID')
    .action(async (options) => {
      try {
        const sender = new MessageSender();

        // Send message
        await sender.send({
          recipient: options.to,
          text: options.text,
          attachmentPath: options.file || '',
          service: options.service,
          region: options.region,
          chatIdentifier: options.chatIdentifier || '',
          chatGUID: options.chatGUID || ''
        });

        console.log('Message sent successfully!');
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
};
